/**
 * A small label that carries meaning: a status, or why a reading is provisional.
 *
 * It takes a **tone**, not a colour. The hue lives in `src/index.css` (`--color-warn`,
 * `--color-ok`, `--color-err`, `--color-text-muted`), and the classes below are the
 * only place a Badge names one — so a call site cannot carry a hex value that
 * drifts away from the theme, and a palette change is one edit rather than a
 * search for hex strings.
 */
export type BadgeTone = "warn" | "ok" | "err" | "muted";

/** Tone → design-system classes. A 20% tint of the same hue, as before. */
const TONE_CLASS: Record<BadgeTone, string> = {
  warn: "bg-warn/20 text-warn",
  ok: "bg-ok/20 text-ok",
  err: "bg-err/20 text-err",
  muted: "bg-text-muted/20 text-text-muted",
};

interface BadgeProps {
  label: string;
  tone: BadgeTone;
  onClick?: () => void;
}

export function Badge({ label, tone, onClick }: BadgeProps) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs ${TONE_CLASS[tone]} ${
        onClick ? "cursor-pointer hover:brightness-125" : ""
      }`}
    >
      {label}
    </Comp>
  );
}
