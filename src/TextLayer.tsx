import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Seg = { text: string; left: number; top: number; width: number; height: number };

// Shared promise cache for the current document; replaced when the document changes.
let cacheDoc = -1;
let cache = new Map<number, Promise<Seg[]>>();

function segmentsFor(docId: number, page: number): Promise<Seg[]> {
  if (docId !== cacheDoc) {
    cacheDoc = docId;
    cache = new Map();
  }
  const current = cache;
  let promise = current.get(page);
  if (!promise) {
    promise = invoke<Seg[]>("page_text", { id: docId, pageIndex: page });
    promise.catch(() => current.delete(page));
    current.set(page, promise);
  }
  return promise;
}

export default function TextLayer({
  docId,
  page,
  scale,
}: {
  docId: number;
  page: number;
  scale: number; // CSS px per PDF point
}) {
  const [segs, setSegs] = useState<Seg[]>([]);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSegs([]);
    segmentsFor(docId, page)
      .then((s) => {
        if (!cancelled) setSegs(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId, page]);

  // Stretch each piece of text horizontally so it covers its real width on the page.
  useLayoutEffect(() => {
    const els = refs.current.slice(0, segs.length);
    els.forEach((el) => {
      if (el) el.style.transform = "none";
    });
    const naturals = els.map((el) => (el ? el.getBoundingClientRect().width : 0));
    els.forEach((el, i) => {
      if (!el || naturals[i] <= 0) return;
      el.style.transform = `scaleX(${(segs[i].width * scale) / naturals[i]})`;
    });
  }, [segs, scale]);

  return (
    <>
      {segs.map((s, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          data-textlayer="1"
          style={{
            position: "absolute",
            left: s.left * scale,
            top: s.top * scale,
            height: s.height * scale,
            lineHeight: `${s.height * scale}px`,
            fontSize: s.height * scale * 0.9,
            whiteSpace: "pre",
            transformOrigin: "0 0",
            color: "transparent",
            cursor: "text",
            userSelect: "text",
          }}
        >
          {s.text}
        </div>
      ))}
    </>
  );
}