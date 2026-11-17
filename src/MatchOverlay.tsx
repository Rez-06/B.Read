import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Rect = [number, number, number, number]; // left, top, width, height in PDF points

// One cache for the current document + query; replaced when either changes.
let cacheKey = "";
let cache = new Map<number, Promise<Rect[]>>();

function matchesFor(docId: number, query: string, page: number): Promise<Rect[]> {
  const key = `${docId}|${query}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cache = new Map();
  }
  const current = cache;
  let promise = current.get(page);
  if (!promise) {
    promise = invoke<Rect[]>("page_matches", { id: docId, pageIndex: page, query });
    promise.catch(() => current.delete(page));
    current.set(page, promise);
  }
  return promise;
}

export default function MatchOverlay({
  docId,
  query,
  page,
  scale,
}: {
  docId: number;
  query: string;
  page: number;
  scale: number; // CSS px per PDF point
}) {
  const [rects, setRects] = useState<Rect[]>([]);

  useEffect(() => {
    let cancelled = false;
    setRects([]);
    matchesFor(docId, query, page)
      .then((r) => {
        if (!cancelled) setRects(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId, query, page]);

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
            background: "rgba(255, 213, 0, 0.4)",
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}