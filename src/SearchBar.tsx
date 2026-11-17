import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const CHUNK = 8; // pages searched per request

export default function SearchBar({
  docId,
  pageCount,
  current,
  onQuery,
  onGoTo,
}: {
  docId: number;
  pageCount: number;
  current: number;
  onQuery: (q: string) => void;
  onGoTo: (index: number) => void;
}) {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<[number, number][]>([]); // [page index, match count]
  const [scanned, setScanned] = useState(0);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const tokenRef = useRef(0);

  // Cancel any running search when this component goes away.
  useEffect(
    () => () => {
      tokenRef.current++;
    },
    [],
  );

  async function run() {
    const q = text.trim();
    const token = ++tokenRef.current;
    onQuery(q);
    setHits([]);
    setScanned(0);
    setSearched(false);
    if (!q) {
      setSearching(false);
      setOpen(false);
      return;
    }
    setOpen(true);
    setSearching(true);
    try {
      for (let start = 0; start < pageCount; start += CHUNK) {
        const got = await invoke<[number, number][]>("search_pages", {
          id: docId,
          query: q,
          start,
          count: CHUNK,
        });
        if (token !== tokenRef.current) return;
        if (got.length) setHits((prev) => [...prev, ...got]);
        setScanned(Math.min(start + CHUNK, pageCount));
      }
      setSearched(true);
    } catch {
      // document closed or search failed
    } finally {
      if (token === tokenRef.current) setSearching(false);
    }
  }

  function step(direction: 1 | -1) {
    if (hits.length === 0) return;
    const pages = hits.map((h) => h[0]);
    if (direction === 1) {
      onGoTo(pages.find((p) => p > current) ?? pages[0]);
    } else {
      const before = pages.filter((p) => p < current);
      onGoTo(before.length ? before[before.length - 1] : pages[pages.length - 1]);
    }
  }

  const totalMatches = hits.reduce((sum, h) => sum + h[1], 0);

  return (
    <div style={{ position: "relative", display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="search"
        placeholder="Search…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") run();
          if (e.key === "Escape") setOpen(false);
        }}
        style={{ width: 160 }}
      />
      <button onClick={() => step(-1)} disabled={hits.length === 0} title="Previous result page">
        ◀
      </button>
      <button onClick={() => step(1)} disabled={hits.length === 0} title="Next result page">
        ▶
      </button>
      <button onClick={() => setOpen((o) => !o)} disabled={!searching && !searched}>
        {searching
          ? `Searching ${scanned}/${pageCount}…`
          : searched
            ? `${totalMatches} matches on ${hits.length} pages`
            : "Results"}
      </button>
      {open && (searching || searched) && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 10,
            width: 260,
            maxHeight: 320,
            overflowY: "auto",
            background: "#2b2b2b",
            border: "1px solid #555",
            marginTop: 4,
          }}
        >
          {hits.length === 0 && (
            <div style={{ padding: 8, opacity: 0.7 }}>
              {searching ? "No matches yet…" : "No matches."}
            </div>
          )}
          {hits.map(([page, n]) => (
            <div
              key={page}
              onClick={() => onGoTo(page)}
              style={{
                padding: "4px 8px",
                cursor: "pointer",
                background: page === current ? "#34507a" : "transparent",
              }}
            >
              Page {page + 1} — {n} {n === 1 ? "match" : "matches"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}