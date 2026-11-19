import type { ReactNode } from "react";
import {
  Eraser,
  Highlighter,
  MessageSquareText,
  MoveHorizontal,
  PanelLeft,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import IconButton from "./IconButton";
import ColorPicker from "./ColorPicker";

const ICON = { size: 16, strokeWidth: 1.75 };

export default function Toolbar({
  showThumbs,
  onToggleThumbs,
  pageText,
  onPageText,
  onPageEnter,
  pageCount,
  search,
  hlColor,
  onHlColor,
  onHighlight,
  onUnhighlight,
  hlMessage,
  showSubtext,
  onToggleSubtext,
  zoom,
  onZoomOut,
  onZoomIn,
  onZoomReset,
  onFitWidth,
  status,
}: {
  showThumbs: boolean;
  onToggleThumbs: () => void;
  pageText: string;
  onPageText: (v: string) => void;
  onPageEnter: () => void;
  pageCount: number;
  search: ReactNode;
  hlColor: string;
  onHlColor: (c: string) => void;
  onHighlight: () => void;
  onUnhighlight: () => void;
  hlMessage: string | null;
  showSubtext: boolean;
  onToggleSubtext: () => void;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomReset: () => void;
  onFitWidth: () => void;
  status: string;
}) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
      <IconButton label="Sidebar (pages and outline)" active={showThumbs} onClick={onToggleThumbs}>
        <PanelLeft {...ICON} />
      </IconButton>
      <span className="sep" />
      <input
        type="number"
        min={1}
        max={pageCount}
        value={pageText}
        title="Go to page"
        onChange={(e) => onPageText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onPageEnter();
        }}
        style={{ width: 56 }}
      />
      <span style={{ color: "var(--text-dim)" }}>/ {pageCount}</span>
      <span className="sep" />
      {search}
      <span className="sep" />
      <IconButton label="Highlight selection" keepSelection onClick={onHighlight}>
        <Highlighter {...ICON} />
      </IconButton>
      <ColorPicker value={hlColor} onChange={onHlColor} />
      <IconButton label="Remove highlight" keepSelection onClick={onUnhighlight}>
        <Eraser {...ICON} />
      </IconButton>
      {hlMessage && <span style={{ color: "var(--danger)" }}>{hlMessage}</span>}
      <span className="sep" />
      <IconButton label="Subtext: transcript and notes" active={showSubtext} onClick={onToggleSubtext}>
        <MessageSquareText {...ICON} />
      </IconButton>
      <span className="sep" />
      <IconButton label="Zoom out" onClick={onZoomOut}>
        <ZoomOut {...ICON} />
      </IconButton>
      <span style={{ minWidth: 44, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
      <IconButton label="Zoom in" onClick={onZoomIn}>
        <ZoomIn {...ICON} />
      </IconButton>
      <IconButton label="Actual size (100%)" wide onClick={onZoomReset}>
        100%
      </IconButton>
      <IconButton label="Fit page width" onClick={onFitWidth}>
        <MoveHorizontal {...ICON} />
      </IconButton>
      <span
        style={{
          marginLeft: "auto",
          color: "var(--text-dim)",
          fontSize: "var(--fs-sm)",
        }}
      >
        {status}
      </span>
    </div>
  );
}