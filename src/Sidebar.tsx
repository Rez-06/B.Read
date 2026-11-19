import { useState } from "react";
import Thumbnails from "./Thumbnails";
import OutlinePanel from "./OutlinePanel";

export default function Sidebar({
  docId,
  pageCount,
  firstPageSize,
  current,
  onSelect,
  mainBusyRef,
}: {
  docId: number;
  pageCount: number;
  firstPageSize: [number, number];
  current: number;
  onSelect: (index: number) => void;
  mainBusyRef: { current: boolean };
}) {
  const [tab, setTab] = useState<"pages" | "outline">("pages");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", flexShrink: 0 }}>
      <div style={{ display: "flex", gap: 4, padding: "0 0 6px" }}>
        <button
          onClick={() => setTab("pages")}
          style={{ background: tab === "pages" ? "var(--accent)" : undefined }}
        >
          Pages
        </button>
        <button
          onClick={() => setTab("outline")}
          style={{ background: tab === "outline" ? "var(--accent)" : undefined }}
        >
          Outline
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "pages" ? (
          <Thumbnails
            docId={docId}
            pageCount={pageCount}
            firstPageSize={firstPageSize}
            current={current}
            onSelect={onSelect}
            mainBusyRef={mainBusyRef}
          />
        ) : (
          <OutlinePanel docId={docId} current={current} onGoTo={onSelect} />
        )}
      </div>
    </div>
  );
}