import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const THUMB_W = 120; // CSS px
const PAD = 8;
const LABEL = 20;
const MAX_THUMBS = 40; // bitmaps kept in memory
const BUFFER = 2; // extra rows rendered above/below the visible ones

function ThumbBitmap({ bitmap, width, height }: { bitmap: ImageBitmap; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    try {
      c.width = bitmap.width;
      c.height = bitmap.height;
      c.getContext("2d")!.drawImage(bitmap, 0, 0);
    } catch {
      // bitmap was evicted while the row was leaving the screen
    }
  }, [bitmap]);
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

export default function Thumbnails({
  docId,
  pageCount,
  firstPageSize,
  current,
  onSelect,
  mainBusyRef,
}: {
  docId: number;
  pageCount: number;
  firstPageSize: [number, number];
  current: number;
  onSelect: (index: number) => void;
  mainBusyRef: { current: boolean };
}) {
  const thumbH = Math.round((THUMB_W * firstPageSize[1]) / firstPageSize[0]);
  const rowH = thumbH + LABEL + PAD * 2;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 10]);
  const rangeRef = useRef<[number, number]>([0, 10]);
  const cacheRef = useRef(new Map<number, ImageBitmap>());
  const [version, setVersion] = useState(0);
  const aliveRef = useRef(true);
  const loopRef = useRef(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = Math.max(0, Math.floor(el.scrollTop / rowH) - BUFFER);
    const last = Math.min(pageCount - 1, Math.ceil((el.scrollTop + el.clientHeight) / rowH) + BUFFER);
    rangeRef.current = [first, last];
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
  }, [rowH, pageCount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  // Free every bitmap when the sidebar goes away.
  useEffect(() => {
    aliveRef.current = true;
    const cache = cacheRef.current;
    return () => {
      aliveRef.current = false;
      cache.forEach((b) => b.close());
      cache.clear();
    };
  }, []);

  // Keep the current page's row in view when the document is scrolled.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = current * rowH;
    if (top < el.scrollTop || top + rowH > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2 + rowH / 2);
    }
  }, [current, rowH]);

  // Render loop: one thumbnail at a time, only while the main view is idle.
  const pump = useCallback(async () => {
    if (loopRef.current) return;
    loopRef.current = true;
    const cache = cacheRef.current;
    try {
      while (aliveRef.current) {
        if (mainBusyRef.current) {
          await new Promise((r) => setTimeout(r, 40));
          continue;
        }
        const [first, last] = rangeRef.current;
        let next = -1;
        for (let i = first; i <= last; i++) {
          if (!cache.has(i)) {
            next = i;
            break;
          }
        }
        if (next < 0) break;

        const buf = await invoke<ArrayBuffer>("render_page", {
          id: docId,
          pageIndex: next,
          width: Math.round(THUMB_W * window.devicePixelRatio),
        });
        const view = new DataView(buf);
        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        const bitmap = await createImageBitmap(
          new ImageData(new Uint8ClampedArray(buf, 8, w * h * 4), w, h),
        );
        if (!aliveRef.current) {
          bitmap.close();
          break;
        }
        cache.set(next, bitmap);

        const [f2, l2] = rangeRef.current;
        for (const key of cache.keys()) {
          if (cache.size <= MAX_THUMBS) break;
          if (key >= f2 && key <= l2) continue;
          cache.get(key)!.close();
          cache.delete(key);
        }
        setVersion((v) => v + 1);
      }
    } catch {
      // document closed or a page failed to render
    } finally {
      loopRef.current = false;
    }
  }, [docId, mainBusyRef]);

  useEffect(() => {
    pump();
  }, [pump, range, version]);

  const rows: number[] = [];
  for (let i = range[0]; i <= range[1]; i++) rows.push(i);

  return (
    <div
      ref={scrollRef}
      onScroll={update}
      style={{
        width: THUMB_W + PAD * 2 + 12,
        flexShrink: 0,
        height: "calc(100vh - 110px)",
        overflowY: "auto",
        background: "#1b1b1b",
      }}
    >
      <div style={{ position: "relative", height: pageCount * rowH }}>
        {rows.map((i) => {
          const bitmap = cacheRef.current.get(i);
          return (
            <div
              key={i}
              onClick={() => onSelect(i)}
              style={{
                position: "absolute",
                top: i * rowH,
                left: 0,
                right: 0,
                height: rowH,
                padding: PAD,
                boxSizing: "border-box",
                cursor: "pointer",
                background: i === current ? "#34507a" : "transparent",
                textAlign: "center",
                fontSize: 12,
              }}
            >
              <div
                style={{
                  width: THUMB_W,
                  height: thumbH,
                  margin: "0 auto",
                  background: "#8a8a8a",
                }}
              >
                {bitmap && <ThumbBitmap bitmap={bitmap} width={THUMB_W} height={thumbH} />}
              </div>
              <div style={{ height: LABEL, lineHeight: `${LABEL}px` }}>{i + 1}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}