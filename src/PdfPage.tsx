import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function PdfPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    const t0 = performance.now();
    invoke<ArrayBuffer>("render_page", { pageIndex: 0, width: 900 })
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
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {ms !== null && <p>Rendered in {ms} ms (Rust + transfer + draw)</p>}
      <canvas ref={canvasRef} />
    </div>
  );
}