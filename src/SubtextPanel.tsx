import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Entry = {
  id: number;
  kind: "transcript" | "note";
  page: number; // 1-based
  seconds: number | null;
  body: string;
};

function fmt(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

// "90", "1:30" or "1:02:03" -> seconds; "" -> null; anything else -> undefined (invalid)
function parseTime(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
}

const textareaStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  font: "inherit",
  color: "var(--text)",
  background: "var(--bg-app)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: 6,
  resize: "vertical" as const,
};

export default function SubtextPanel({
  docKey,
  current,
  pageCount,
  onGoTo,
}: {
  docKey: string | null;
  current: number; // 0-based
  pageCount: number;
  onGoTo: (index: number) => void;
}) {
  const [tab, setTab] = useState<"transcript" | "note">("transcript");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [pageText, setPageText] = useState("");
  const [timeText, setTimeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editPage, setEditPage] = useState("");
  const [editTime, setEditTime] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    if (docKey === null) {
      setEntries([]);
      return;
    }
    try {
      setEntries(await invoke<Entry[]>("subtext_list", { docKey }));
    } catch (e) {
      setError(String(e));
    }
  }, [docKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function add() {
    if (docKey === null) {
      setError("Still identifying this file. Try again in a moment.");
      return;
    }
    const page = pageText.trim() ? parseInt(pageText, 10) : current + 1;
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      setError(`Page must be between 1 and ${pageCount}.`);
      return;
    }
    const seconds = tab === "transcript" ? parseTime(timeText) : null;
    if (seconds === undefined) {
      setError("Time must look like 90, 1:30 or 1:02:03.");
      return;
    }
    try {
      await invoke("subtext_add", { docKey, kind: tab, page, seconds, body: text });
      setText("");
      setError(null);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(id: number) {
    try {
      await invoke("subtext_delete", { id });
      if (editingId === id) setEditingId(null);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  function startEdit(e: Entry) {
    setEditingId(e.id);
    setEditText(e.body);
    setEditPage(String(e.page));
    setEditTime(e.seconds !== null ? fmt(e.seconds) : "");
    setError(null);
  }

  async function saveEdit(e: Entry) {
    const page = parseInt(editPage, 10);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      setError(`Page must be between 1 and ${pageCount}.`);
      return;
    }
    const seconds = e.kind === "transcript" ? parseTime(editTime) : null;
    if (seconds === undefined) {
      setError("Time must look like 90, 1:30 or 1:02:03.");
      return;
    }
    try {
      await invoke("subtext_update", { id: e.id, page, seconds, body: editText });
      setEditingId(null);
      setError(null);
      await reload();
    } catch (err) {
      setError(String(err));
    }
  }

  const needle = filter.trim().toLowerCase();
  const shown = entries.filter(
    (e) => e.kind === tab && (!needle || e.body.toLowerCase().includes(needle)),
  );

  // Keep the entries for the current page in view as the PDF is scrolled.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [current, entries, tab]);

  return (
    <div
      style={{
        order: 3,
        width: 320,
        flexShrink: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", gap: 4, padding: 8 }}>
        <button
          onClick={() => setTab("transcript")}
          style={{ background: tab === "transcript" ? "var(--accent)" : undefined }}
        >
          Transcript
        </button>
        <button
          onClick={() => setTab("note")}
          style={{ background: tab === "note" ? "var(--accent)" : undefined }}
        >
          Notes
        </button>
      </div>

      <div style={{ padding: "0 8px 8px" }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter entries…"
          style={{ width: "100%", boxSizing: "border-box" }}
        />
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px" }}>
        {docKey === null && (
          <div style={{ color: "var(--text-dim)", padding: 8 }}>Identifying document…</div>
        )}
        {shown.length === 0 && docKey !== null && (
          <div style={{ color: "var(--text-dim)", padding: 8 }}>
            {needle
              ? "No entries match the filter."
              : `No ${tab === "transcript" ? "transcript entries" : "notes"} for this document yet.`}
          </div>
        )}
        {shown.map((e) =>
          editingId === e.id ? (
            <div
              key={e.id}
              style={{
                padding: 8,
                marginBottom: 4,
                borderRadius: 4,
                background: "var(--bg-control)",
              }}
            >
              <textarea
                autoFocus
                value={editText}
                onChange={(ev) => setEditText(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && ev.ctrlKey) saveEdit(e);
                  if (ev.key === "Escape") setEditingId(null);
                }}
                rows={3}
                style={textareaStyle}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                <input
                  value={editPage}
                  onChange={(ev) => setEditPage(ev.target.value)}
                  placeholder="page"
                  style={{ width: 56 }}
                />
                {e.kind === "transcript" && (
                  <input
                    value={editTime}
                    onChange={(ev) => setEditTime(ev.target.value)}
                    placeholder="time 1:30"
                    style={{ width: 72 }}
                  />
                )}
                <button onClick={() => setEditingId(null)} style={{ marginLeft: "auto" }}>
                  Cancel
                </button>
                <button onClick={() => saveEdit(e)}>Save</button>
              </div>
            </div>
          ) : (
            <div
              key={e.id}
              data-active={e.page === current + 1}
              onClick={() => onGoTo(e.page - 1)}
              style={{
                padding: "6px 8px",
                marginBottom: 4,
                cursor: "pointer",
                borderRadius: 4,
                background: e.page === current + 1 ? "var(--accent)" : "var(--bg-control)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--text-dim)",
                }}
              >
                <span>
                  {e.seconds !== null ? `${fmt(e.seconds)} · ` : ""}page {e.page}
                </span>
                <span style={{ display: "flex", gap: 10 }}>
                  <span
                    title="Edit"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      startEdit(e);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    ✎
                  </span>
                  <span
                    title="Delete"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      remove(e.id);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    ×
                  </span>
                </span>
              </div>
              <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{e.body}</div>
            </div>
          ),
        )}
      </div>

      <div style={{ padding: 8, borderTop: "1px solid var(--border)" }}>
        {error && <div style={{ color: "var(--danger)", marginBottom: 4 }}>{error}</div>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) add();
          }}
          placeholder={tab === "transcript" ? "Transcript text…" : "Note…"}
          rows={3}
          style={textareaStyle}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
          <input
            value={pageText}
            onChange={(e) => setPageText(e.target.value)}
            placeholder={`page ${current + 1}`}
            style={{ width: 64 }}
          />
          {tab === "transcript" && (
            <input
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              placeholder="time 1:30"
              style={{ width: 80 }}
            />
          )}
          <button onClick={add} style={{ marginLeft: "auto" }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}