import { NOTICE_TONE_CLASS } from "../../lib/noticeTone";

/**
 * A small label that carries meaning: a status, or why a reading could not be
 * decoded.
 *
 * It takes a **tone**, not a colour. The hue lives in `src/index.css`
 * (`--color-warn`, `--color-ok`, `--color-err`, `--color-text-muted`), and the ink
 * per tone is `lib/noticeTone`'s `NOTICE_TONE_CLASS` — the same table a notice, a
 * toast and a batch attempt read — so a warn pill and a warn line of text cannot
 * end up two different ambers. What this module adds is what only a pill needs:
 * the 20% tint behind the word.
 */
export type BadgeTone = "warn" | "ok" | "err" | "muted";

/** Tone → design-system classes. A 20% tint of the same hue, as before. */
const TONE_CLASS: Record<BadgeTone, string> = {
  warn: `bg-warn/20 ${NOTICE_TONE_CLASS.warn}`,
  ok: `bg-ok/20 ${NOTICE_TONE_CLASS.ok}`,
  err: `bg-err/20 ${NOTICE_TONE_CLASS.err}`,
  muted: `bg-text-muted/20 ${NOTICE_TONE_CLASS.muted}`,
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
