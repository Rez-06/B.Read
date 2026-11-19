import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type Rect = [number, number, number, number]; // left, top, width, height in PDF points
export type Highlight = { id: number; page: number; rects: Rect[]; color: string; text: string };

export const COLORS: Record<string, string> = {
  yellow: "rgba(255, 213, 0, 0.4)",
  green: "rgba(80, 220, 120, 0.35)",
  pink: "rgba(255, 105, 180, 0.35)",
  blue: "rgba(80, 160, 255, 0.35)",
};

export type Group = { page: number; rects: Rect[]; text: string };

/** Joins pieces on the same line into one bar, closing the gaps between words. */
function mergeLines(rects: Rect[]): Rect[] {
  type Line = { top: number; bottom: number; items: Rect[] };
  const lines: Line[] = [];
  for (const r of rects) {
    const top = r[1];
    const bottom = r[1] + r[3];
    const line = lines.find(
      (l) => Math.min(l.bottom, bottom) - Math.max(l.top, top) > 0.5 * Math.min(l.bottom - l.top, r[3]),
    );
    if (line) {
      line.items.push(r);
      line.top = Math.min(line.top, top);
      line.bottom = Math.max(line.bottom, bottom);
    } else {
      lines.push({ top, bottom, items: [r] });
    }
  }

  const out: Rect[] = [];
  for (const l of lines) {
    l.items.sort((a, b) => a[0] - b[0]);
    const h = l.bottom - l.top;
    let cur: Rect = [l.items[0][0], l.top, l.items[0][2], h];
    for (let i = 1; i < l.items.length; i++) {
      const r = l.items[i];
      if (r[0] - (cur[0] + cur[2]) <= 0.8 * h) {
        cur[2] = Math.max(cur[0] + cur[2], r[0] + r[2]) - cur[0];
      } else {
        out.push(cur);
        cur = [r[0], l.top, r[2], h];
      }
    }
    out.push(cur);
  }
  return out;
}

/** Turns the current text selection into per-page rectangles in PDF points. */
export function readSelection(scale: number): Group[] {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];
  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer;
  const walkRoot = root.nodeType === Node.TEXT_NODE ? root.parentNode! : root;
  const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT);
  const groups = new Map<number, { rects: Rect[]; parts: string[] }>();
  const pageBoxes = new Map<number, DOMRect>();

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!range.intersectsNode(node)) continue;
    const seg = node.parentElement?.closest<HTMLElement>("[data-textlayer]");
    const pageEl = seg?.closest<HTMLElement>("[data-page]");
    if (!seg || !pageEl) continue;
    const page = Number(pageEl.dataset.page);

    let start = 0;
    let end = node.data.length;
    const r = document.createRange();
    r.selectNodeContents(node);
    if (node === range.startContainer) {
      start = range.startOffset;
      r.setStart(node, start);
    }
    if (node === range.endContainer) {
      end = range.endOffset;
      r.setEnd(node, end);
    }
    if (start >= end) continue;
    const partial = start > 0 || end < node.data.length;

    let box = pageBoxes.get(page);
    if (!box) {
      box = pageEl.getBoundingClientRect();
      pageBoxes.set(page, box);
    }
    // Vertical extent always comes from the PDF's own segment rectangle (the segment's box).
    const segBox = seg.getBoundingClientRect();
    let left = segBox.left;
    let right = segBox.right;
    if (partial) {
      // Selection stops inside this segment: the horizontal edge is an estimate.
      const crs = Array.from(r.getClientRects()).filter((cr) => cr.width >= 0.5);
      if (crs.length === 0) continue;
      left = Math.min(...crs.map((cr) => cr.left));
      right = Math.max(...crs.map((cr) => cr.right));
    }

    const g = groups.get(page) ?? { rects: [], parts: [] };
    g.rects.push([
      (left - box.left) / scale,
      (segBox.top - box.top) / scale,
      (right - left) / scale,
      segBox.height / scale,
    ]);
    g.parts.push(node.data.slice(start, end));
    groups.set(page, g);
  }

  return [...groups.entries()]
    .filter(([, g]) => g.rects.length > 0)
    .map(([page, g]) => ({ page, rects: mergeLines(g.rects), text: g.parts.join(" ").trim() }));
}

function centreInside(a: Rect, b: Rect): boolean {
  const cx = a[0] + a[2] / 2;
  const cy = a[1] + a[3] / 2;
  const pad = 1;
  return (
    cx >= b[0] - pad && cx <= b[0] + b[2] + pad && cy >= b[1] - pad && cy <= b[1] + b[3] + pad
  );
}

export function useHighlights(docKey: string | null, scale: number) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  const reload = useCallback(async () => {
    if (docKey === null) {
      setHighlights([]);
      return;
    }
    try {
      setHighlights(await invoke<Highlight[]>("highlight_list", { docKey }));
    } catch {
      // database unavailable; leave the list as it is
    }
  }, [docKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  const byPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of highlights) {
      const list = map.get(h.page);
      if (list) list.push(h);
      else map.set(h.page, [h]);
    }
    return map;
  }, [highlights]);

  /** Returns an error message, or null on success. */
  const add = useCallback(
    async (color: string): Promise<string | null> => {
      if (docKey === null) return "Still identifying this file.";
      const groups = readSelection(scale);
      if (groups.length === 0) return "Select some text first.";
      try {
        for (const g of groups) {
          await invoke("highlight_add", {
            docKey,
            page: g.page,
            rects: g.rects,
            color,
            text: g.text,
          });
        }
        await reload();
        return null;
      } catch (e) {
        return String(e);
      }
    },
    [docKey, scale, reload],
  );

  /** Removes highlights under the current selection. Returns an error message, or null. */
  const remove = useCallback(async (): Promise<string | null> => {
    const groups = readSelection(scale);
    if (groups.length === 0) return "Select highlighted text first.";
    const doomed = new Set<number>();
    for (const g of groups) {
      for (const h of byPage.get(g.page) ?? []) {
        if (
          h.rects.some((hr) => g.rects.some((sr) => centreInside(sr, hr) || centreInside(hr, sr)))
        ) {
          doomed.add(h.id);
        }
      }
    }
    if (doomed.size === 0) return "No highlight under the selection.";
    try {
      for (const id of doomed) await invoke("highlight_delete", { id });
      await reload();
      return null;
    } catch (e) {
      return String(e);
    }
  }, [scale, byPage, reload]);

  return { byPage, add, remove };
}

export function HighlightOverlay({
  rects,
  color,
  scale,
}: {
  rects: Rect[];
  color: string;
  scale: number; // CSS px per PDF point
}) {
  const fill = COLORS[color] ?? COLORS.yellow;
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
            background: fill,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}