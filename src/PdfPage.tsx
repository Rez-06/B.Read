import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function PdfPage({ path }: { path: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
        invoke<number>("page_count", { path }).then(setCount).catch((e) => setError(String(e)));
  }, [path]);

  useEffect(() => {
    const t0 = performance.now();
        invoke<ArrayBuffer>("render_page", { path, pageIndex: page, width: 900 })
      .then((buf) => {
        const view = new DataView(buf);
        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        const pixels = new Uint8ClampedArray(buf, 8, w * h * 4);
        const canvas = canvasRef.current!;
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.putImageData(new ImageData(pixels, w, h), 0, 0);
        setMs(Math.round(performance.now() - t0));
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [page]);

  const go = useCallback(
    (delta: number) => setPage((p) => Math.min(Math.max(p + delta, 0), Math.max(count - 1, 0))),
    [count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button onClick={() => go(-1)} disabled={page === 0}>Previous</button>
        <span>Page {page + 1} / {count || "?"}</span>
        <button onClick={() => go(1)} disabled={page >= count - 1}>Next</button>
        {ms !== null && <span style={{ opacity: 0.6 }}>{ms} ms</span>}
      </div>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      <canvas ref={canvasRef} />
    </div>
  );
}