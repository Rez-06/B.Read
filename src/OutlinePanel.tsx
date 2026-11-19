import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Item = { title: string; page: number | null; depth: number };

export const OUTLINE_WIDTH = 240;

export default function OutlinePanel({
  docId,
  current,
  onGoTo,
}: {
  docId: number;
  current: number; // 0-based
  onGoTo: (index: number) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Item[]>("document_outline", { id: docId })
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // The section you're in: the last item that starts on or before the current page.
  let active = -1;
  if (items) {
    items.forEach((it, i) => {
      if (it.page !== null && it.page <= current) active = i;
    });
  }

  return (
    <div
      style={{
        width: OUTLINE_WIDTH,
        height: "100%",
        overflowY: "auto",
        background: "#1b1b1b",
      }}
    >
      {error && <div style={{ padding: 8, color: "var(--danger)" }}>{error}</div>}
      {!error && items === null && (
        <div style={{ padding: 8, color: "var(--text-dim)" }}>Loading outline…</div>
      )}
      {items && items.length === 0 && (
        <div style={{ padding: 8, color: "var(--text-dim)" }}>
          This document has no outline.
        </div>
      )}
      {items?.map((it, i) => (
        <div
          key={i}
          title={it.title}
          onClick={() => it.page !== null && onGoTo(it.page)}
          style={{
            padding: "4px 8px",
            paddingLeft: 8 + Math.min(it.depth, 8) * 14,
            cursor: it.page !== null ? "pointer" : "default",
            color: it.page !== null ? "var(--text)" : "var(--text-dim)",
            background: i === active ? "var(--accent)" : "transparent",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {it.title || "(untitled)"}
        </div>
      ))}
    </div>
  );
}