import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
const USE_PROTOCOL = true;
export default function PdfPage({ docId, count }: { docId: number; count: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [page, setPage] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [ms, setMs] = useState<number | null>(null);
    const [timing, setTiming] = useState("");
    
      useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    let tHeaders = t0;
    const request: Promise<ArrayBuffer> = USE_PROTOCOL
      ? fetch(`http://pdfpage.localhost/${docId}/${page}/900`).then(async (r) => {
          tHeaders = performance.now();
          if (!r.ok) throw new Error(await r.text());
          return r.arrayBuffer();
        })
      : invoke<ArrayBuffer>("render_page", { id: docId, pageIndex: page, width: 900 });
    request
      .then((buf) => {
        if (cancelled) return;
        const tBody = performance.now();
        const view = new DataView(buf);
        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        const pixels = new Uint8ClampedArray(buf, 8, w * h * 4);
        const canvas = canvasRef.current!;
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.putImageData(new ImageData(pixels, w, h), 0, 0);
        const tDone = performance.now();
        setMs(Math.round(tDone - t0));
        // Wait two animation frames so we also measure the real on-screen paint.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const tPaint = performance.now();
            const net = USE_PROTOCOL
              ? `headers ${Math.round(tHeaders - t0)} + body ${Math.round(tBody - tHeaders)}`
              : `call ${Math.round(tBody - t0)}`;
            setTiming(
              `${net} + draw ${Math.round(tDone - tBody)} + paint ${Math.round(tPaint - tDone)}`,
            );
          }),
        );
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [page, docId]);

  const go = useCallback(
    (delta: number) => setPage((p) => Math.min(Math.max(p + delta, 0), count - 1)),
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
        <span>Page {page + 1} / {count}</span>
        <button onClick={() => go(1)} disabled={page >= count - 1}>Next</button>
                {ms !== null && <span style={{ opacity: 0.6 }}>{ms} ms ({timing})</span>}
      </div>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      <canvas ref={canvasRef} />
    </div>
  );
}