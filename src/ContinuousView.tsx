import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Thumbnails from "./Thumbnails";
import SearchBar from "./SearchBar";
import MatchOverlay from "./MatchOverlay";
import TextLayer from "./TextLayer";
import SubtextPanel from "./SubtextPanel";
import { COLORS, HighlightOverlay, useHighlights } from "./Highlights";
import { SelectionBand, useSelectionBands } from "./SelectionBands";
const GAP = 12; // px between pages
const BASE = 96 / 72; // PDF points -> CSS px at 100% zoom
const CHUNK = 8; // pages whose sizes are fetched per request
const MAX_CACHE = 12; // rendered pages kept in memory
const MAX_RENDER_PX = 1800; // cap on rendered bitmap width (transfer cost grows with size)
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
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
    initialPage,
    docKey,
  initialZoom,
  onViewState,
}: {
  docId: number;
  pageCount: number;
  firstPageSize: Size;
  initialPage: number;
  docKey: string | null;
  initialZoom: number;
  onViewState: (page: number, zoom: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [sizes, setSizes] = useState<Size[]>(() =>
    Array.from({ length: pageCount }, () => firstPageSize),
  );
  const [query, setQuery] = useState("");
  const [showSubtext, setShowSubtext] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [zoom, setZoom] = useState(initialZoom);
  const [current, setCurrent] = useState(initialPage);
  const [showThumbs, setShowThumbs] = useState(true);
  const [pageText, setPageText] = useState("1");
    const [hlColor, setHlColor] = useState("yellow");
  const [hlMessage, setHlMessage] = useState<string | null>(null);
  const zoomRef = useRef(initialZoom);
  const scale = zoom * BASE; // PDF points -> CSS px
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
    const hl = useHighlights(docKey, scale);
      const selBands = useSelectionBands(scale);
  const runHighlight = async (action: () => Promise<string | null>) => {
    const msg = await action();
    setHlMessage(msg);
    if (msg) setTimeout(() => setHlMessage(null), 3000);
  };
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
      y += h * scale + GAP;
      maxWidth = Math.max(maxWidth, w * scale);
    }
    return { tops, total: y, maxWidth };
  }, [sizes, scale]);

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
    setCurrent(indexAt(el.scrollTop + el.clientHeight * 0.3));
    rangeRef.current = [first, last];
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
  }, [indexAt, layout]);

  // When the layout changes (real sizes arrive, zoom changes), keep the anchor page in place.
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
          return !e || e.cssW !== Math.round(sizesRef.current[i][0] * scaleRef.current);
        });
        if (next === undefined) break;

        const cssW = Math.round(sizesRef.current[next][0] * scaleRef.current);
        const t0 = performance.now();
        const buf = await invoke<ArrayBuffer>("render_page", {
          id: docId,
          pageIndex: next,
          width: Math.min(Math.round(cssW * window.devicePixelRatio), MAX_RENDER_PX),
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
  }, [pump, range, sizes, version, zoom]);

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

  // Zoom keeps the page at the top of the viewport (and your position within it) in place.
  const zoomTo = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, ZOOM_MIN), ZOOM_MAX);
    const prev = zoomRef.current;
    if (clamped === prev) return;
    const a = anchorRef.current;
    if (a.delta > 0) anchorRef.current = { ...a, delta: (a.delta * clamped) / prev };
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  const fitWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const widest = Math.max(...sizesRef.current.map((s) => s[0]));
    zoomTo((el.clientWidth - 2 * GAP) / (widest * BASE));
  }, [zoomTo]);

    // Restore the saved page when this tab is shown again.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && initialPage > 0) {
      el.scrollTop = layout.tops[Math.min(initialPage, pageCount - 1)] - GAP;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Report page and zoom so the tab can be restored later.
  useEffect(() => {
    onViewState(current, zoom);
  }, [current, zoom, onViewState]);
  
  const goTo = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const i = Math.min(Math.max(index, 0), pageCount - 1);
      el.scrollTop = layout.tops[i] - GAP;
    },
    [layout, pageCount],
  );

  // Keep the page box in sync with scrolling.
  useEffect(() => setPageText(String(current + 1)), [current]);

  // Give the scroll area keyboard focus so arrows/PageUp/PageDown/Home/End work natively.
  useEffect(() => {
    scrollRef.current?.focus();
  }, []);

  const onKey = (e: { ctrlKey: boolean; key: string; preventDefault(): void }) => {
    if (!e.ctrlKey) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      zoomTo(zoomRef.current * 1.25);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomTo(zoomRef.current / 1.25);
    } else if (e.key === "0") {
      e.preventDefault();
      zoomTo(1);
    }
  };

  // Ctrl + mouse wheel zooms (needs a non-passive listener to block browser zoom).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button onClick={() => setShowThumbs((s) => !s)}>
          {showThumbs ? "Hide thumbnails" : "Thumbnails"}
        </button>
        <input
          type="number"
          min={1}
          max={pageCount}
          value={pageText}
          onChange={(e) => setPageText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const n = parseInt(pageText, 10);
              if (!Number.isNaN(n)) goTo(n - 1);
              scrollRef.current?.focus();
            }
          }}
          style={{ width: 64 }}
        />
        <span>/ {pageCount}</span>
                <SearchBar docId={docId} pageCount={pageCount} current={current} onGoTo={goTo} onQuery={setQuery} />
                        <select
          value={hlColor}
          onChange={(e) => setHlColor(e.target.value)}
          title="Highlight colour"
        >
          {Object.keys(COLORS).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runHighlight(() => hl.add(hlColor))}
        >
          Highlight
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runHighlight(() => hl.remove())}
        >
          Unhighlight
        </button>
        {hlMessage && <span style={{ color: "var(--danger)" }}>{hlMessage}</span>}
                        <button onClick={() => setShowSubtext((s) => !s)}>
          {showSubtext ? "Hide subtext" : "Subtext"}
        </button>
        <button onClick={() => zoomTo(zoomRef.current / 1.25)}>−</button>
        <span style={{ minWidth: 48, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => zoomTo(zoomRef.current * 1.25)}>+</button>
        <button onClick={() => zoomTo(1)}>100%</button>
        <button onClick={fitWidth}>Fit width</button>
        <span style={{ opacity: 0.8 }}>
          sizes {loaded}/{pageCount} · cached {cacheRef.current.size} · last render{" "}
          {lastMs ?? "–"} ms
        </span>
      </div>
            <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0 }}>
                {showSubtext && (
          <SubtextPanel docKey={docKey} current={current} pageCount={pageCount} onGoTo={goTo} />
        )}
        {showThumbs && (
          <Thumbnails
            docId={docId}
            pageCount={pageCount}
            firstPageSize={firstPageSize}
            current={current}
            onSelect={goTo}
            mainBusyRef={busyRef}
          />
        )}
        <div
          ref={scrollRef}
          onScroll={update}
          tabIndex={0}
                    onKeyDown={onKey}
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest("[data-textlayer]")) {
              window.getSelection()?.removeAllRanges();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            overflow: "auto",
            background: "#222",
            outline: "none",
          }}
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
                  data-page={i}
                  style={{
                    position: "absolute",
                    top: layout.tops[i],
                    left: (layout.maxWidth - w * scale) / 2,
                    width: w * scale,
                    height: h * scale,
                    background: visible ? "#fff" : "#8a8a8a",
                    color: "#000",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                  }}
                >                   {query && nearby && <MatchOverlay docId={docId} query={query} page={i} scale={scale} />}
                                    {nearby && <TextLayer docId={docId} page={i} scale={scale} />}
                                    {nearby &&
                    hl.byPage
                      .get(i)
                      ?.map((h) => (
                        <HighlightOverlay key={h.id} rects={h.rects} color={h.color} scale={scale} />
                      ))}
                                        {nearby && selBands.get(i) && <SelectionBand rects={selBands.get(i)!} scale={scale} />}
                  {entry ? (
                    <PageBitmap bitmap={entry.bitmap} width={w * scale} height={h * scale} />
                  ) : (
                    <>Page {i + 1}</>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}