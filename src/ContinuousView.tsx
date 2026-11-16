import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const GAP = 12; // px between pages
const SCALE = 96 / 72; // PDF points -> CSS px at 100% zoom
const CHUNK = 8; // pages whose sizes are fetched per request
const MAX_CACHE = 12; // rendered pages kept in memory
const LOAD_SIZES = true;

type Size = [number, number];
type Cached = { bitmap: ImageBitmap; cssW: number };

function PageBitmap({ bitmap, width, height }: { bitmap: ImageBitmap; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    try {
      c.width = bitmap.width;
      c.height = bitmap.height;
      c.getContext("2d")!.drawImage(bitmap, 0, 0);
    } catch {
      // bitmap was evicted while this page was leaving the screen
    }
  }, [bitmap]);
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

export default function ContinuousView({
  docId,
  pageCount,
  firstPageSize,
}: {
  docId: number;
  pageCount: number;
  firstPageSize: Size;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [sizes, setSizes] = useState<Size[]>(() =>
    Array.from({ length: pageCount }, () => firstPageSize),
  );
  const [loaded, setLoaded] = useState(0);
  const rangeRef = useRef<[number, number]>([0, 0]);
  const anchorRef = useRef({ index: 0, delta: -GAP });

  // Rendering state
  const cacheRef = useRef(new Map<number, Cached>());
  const [version, setVersion] = useState(0); // bumps when a page finishes rendering
  const [lastMs, setLastMs] = useState<number | null>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  const layout = useMemo(() => {
    const tops: number[] = [];
    let y = GAP;
    let maxWidth = 0;
    for (const [w, h] of sizes) {
      tops.push(y);
      y += h * SCALE + GAP;
      maxWidth = Math.max(maxWidth, w * SCALE);
    }
    return { tops, total: y, maxWidth };
  }, [sizes]);

  const indexAt = useCallback(
    (y: number) => {
      let lo = 0;
      let hi = layout.tops.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (layout.tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [layout],
  );

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = indexAt(el.scrollTop);
    const last = indexAt(el.scrollTop + el.clientHeight);
    anchorRef.current = { index: first, delta: el.scrollTop - layout.tops[first] };
    rangeRef.current = [first, last];
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
  }, [indexAt, layout]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const a = anchorRef.current;
    const target = layout.tops[a.index] + a.delta;
    if (Math.abs(el.scrollTop - target) > 0.5) el.scrollTop = target;
  }, [layout]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  // Free every cached bitmap when this view goes away.
  useEffect(() => {
    aliveRef.current = true;
    const cache = cacheRef.current;
    return () => {
      aliveRef.current = false;
      cache.forEach((e) => e.bitmap.close());
      cache.clear();
    };
  }, []);

  // Render loop: one page at a time, always the most useful page for the current view.
  const pump = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const cache = cacheRef.current;
    let aborted = false;
    try {
      while (aliveRef.current) {
        const [first, last] = rangeRef.current;
        const wanted: number[] = [];
        for (let i = first; i <= last; i++) wanted.push(i);
        if (last + 1 < pageCount) wanted.push(last + 1);
        if (first > 0) wanted.push(first - 1);

        const next = wanted.find((i) => {
          const e = cache.get(i);
          return !e || e.cssW !== Math.round(sizesRef.current[i][0] * SCALE);
        });
        if (next === undefined) break;

        const cssW = Math.round(sizesRef.current[next][0] * SCALE);
        const t0 = performance.now();
        const buf = await invoke<ArrayBuffer>("render_page", {
          id: docId,
          pageIndex: next,
          width: Math.round(cssW * window.devicePixelRatio),
        });
        const view = new DataView(buf);
        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        const bitmap = await createImageBitmap(
          new ImageData(new Uint8ClampedArray(buf, 8, w * h * 4), w, h),
        );
        if (!aliveRef.current) {
          bitmap.close();
          aborted = true;
          break;
        }

        cache.get(next)?.bitmap.close();
        cache.delete(next);
        cache.set(next, { bitmap, cssW });

        // Evict oldest-rendered pages that are not near the viewport.
        const [f2, l2] = rangeRef.current;
        for (const key of cache.keys()) {
          if (cache.size <= MAX_CACHE) break;
          if (key >= f2 - 1 && key <= l2 + 1) continue;
          cache.get(key)!.bitmap.close();
          cache.delete(key);
        }

        setLastMs(Math.round(performance.now() - t0));
        setVersion((v) => v + 1);
      }
    } catch {
      // document closed or this page failed to render
    } finally {
      busyRef.current = false;
      // If an old loop quit because the view remounted, start a fresh one.
      if (aborted && aliveRef.current) setVersion((v) => v + 1);
    }
  }, [docId, pageCount]);

  useEffect(() => {
    pump();
  }, [pump, range, sizes, version]);

  // Background loader: real page sizes, chunks nearest the viewport first.
  useEffect(() => {
    if (!LOAD_SIZES) return;
    let cancelled = false;
    const done = new Set<number>();
    const chunks = Math.ceil(pageCount / CHUNK);

    const pick = () => {
      const centre = Math.floor(rangeRef.current[0] / CHUNK);
      let best = -1;
      let bestDist = Infinity;
      for (let c = 0; c < chunks; c++) {
        if (done.has(c)) continue;
        const d = Math.abs(c - centre);
        if (d < bestDist) {
          best = c;
          bestDist = d;
        }
      }
      return best;
    };

    (async () => {
      while (!cancelled) {
        const c = pick();
        if (c < 0) break;
        done.add(c);
        try {
          const got = await invoke<Size[]>("page_sizes", {
            id: docId,
            start: c * CHUNK,
            count: CHUNK,
          });
          if (cancelled) return;
          setSizes((prev) => {
            const next = prev.slice();
            got.forEach((s, i) => {
              next[c * CHUNK + i] = s;
            });
            return next;
          });
          setLoaded((n) => n + got.length);
        } catch {
          break;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [docId, pageCount]);

  return (
    <div>
      <div style={{ marginBottom: 8, opacity: 0.8 }}>
        Visible: pages {range[0] + 1}–{range[1] + 1} of {pageCount} · sizes {loaded}/{pageCount} ·
        cached {cacheRef.current.size} · last render {lastMs ?? "–"} ms
      </div>
      <div
        ref={scrollRef}
        onScroll={update}
        style={{ height: "calc(100vh - 110px)", overflow: "auto", background: "#222" }}
      >
        <div
          style={{
            position: "relative",
            height: layout.total,
            width: layout.maxWidth,
            margin: "0 auto",
          }}
        >
          {sizes.map(([w, h], i) => {
            const visible = i >= range[0] && i <= range[1];
            const nearby = i >= range[0] - 1 && i <= range[1] + 1;
            const entry = nearby ? cacheRef.current.get(i) : undefined;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: layout.tops[i],
                  left: (layout.maxWidth - w * SCALE) / 2,
                  width: w * SCALE,
                  height: h * SCALE,
                  background: visible ? "#fff" : "#8a8a8a",
                  color: "#000",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                }}
              >
                {entry ? (
                  <PageBitmap bitmap={entry.bitmap} width={w * SCALE} height={h * SCALE} />
                ) : (
                  <>Page {i + 1}</>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}