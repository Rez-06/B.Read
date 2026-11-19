import { useEffect, useState } from "react";
import { readSelection, type Rect } from "./Highlights";

const BAND = "rgba(52, 120, 246, 0.35)";

/** Selection rectangles per page, in PDF points, updated as the selection changes. */
export function useSelectionBands(scale: number) {
  const [bands, setBands] = useState<{ key: string; map: Map<number, Rect[]> }>({
    key: "",
    map: new Map(),
  });

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const groups = readSelection(scale);
      const key = JSON.stringify(groups.map((g) => [g.page, g.rects]));
      setBands((prev) =>
        prev.key === key ? prev : { key, map: new Map(groups.map((g) => [g.page, g.rects])) },
      );
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scale]);

  return bands.map;
}

export function SelectionBand({ rects, scale }: { rects: Rect[]; scale: number }) {
  return (
    <>
      {rects.map(([l, t, w, h], i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: l * scale,
            top: t * scale,
            width: w * scale,
            height: h * scale,
            background: BAND,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}