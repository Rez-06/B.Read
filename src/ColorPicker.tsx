import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { COLORS } from "./Highlights";

// Solid versions of the highlight colours, for showing on buttons.
export const SWATCH: Record<string, string> = {
  yellow: "#ffd500",
  green: "#50dc78",
  pink: "#ff69b4",
  blue: "#50a0ff",
};

export default function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="color-picker">
      <button
        className="icon-btn tip"
        data-tip="Highlight colour"
        aria-label="Highlight colour"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="swatch" style={{ background: SWATCH[value] }} />
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div className="palette" role="menu">
          {Object.keys(COLORS).map((name) => (
            <button
              key={name}
              className={`swatch-btn${name === value ? " on" : ""}`}
              title={name}
              aria-label={name}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
            >
              <span className="swatch" style={{ background: SWATCH[name] }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}