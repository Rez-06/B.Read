import type { ReactNode } from "react";

export default function IconButton({
  label,
  onClick,
  disabled,
  active,
  wide,
  keepSelection,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  wide?: boolean;
  /** Don't take focus on press, so a text selection survives clicking the button. */
  keepSelection?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className={`icon-btn tip${wide ? " wide" : ""}${active ? " on" : ""}`}
      data-tip={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keepSelection ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}