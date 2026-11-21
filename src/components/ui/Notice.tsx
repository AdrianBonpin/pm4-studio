import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Info,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "./Button";

/**
 * A notice: a condition the user is in, drawn as a box rather than as a bar.
 *
 * A condition — a library file that cannot be written to, a migration warning, an
 * invalid Record, a pending confirmation — stays on the page and stays true until
 * something changes it. It is not an event, so it is not a Toast (see
 * `lib/outcome.ts`), and it is not `ToastViewport`'s to draw.
 *
 * This is the one rendering of that box, and it exists because the treatment it
 * replaces was announced by a coloured rule down the left edge: the hue was the
 * only thing saying "this is a warning" and not "this is a failure", so a user
 * who cannot distinguish the accent colours lost the distinction entirely, and a
 * screenshot with the bar cropped off lost it too. So a notice now carries the
 * severity through four channels at once:
 *
 *   1. **A word.** `label` is required and in the tone's ink. "Check this", "Not
 *      written", "Saving is off". It is the channel that needs no eyesight for
 *      colour and no cropping.
 *   2. **A shape.** Each tone has its own icon: an octagon, a triangle, a tick, a
 *      circle, a clock. Distinct silhouettes, so the tone survives colour
 *      blindness. It is `aria-hidden`, because the words already say it and a
 *      screen reader reading "warning warning" helps nobody.
 *   3. **A tint.** The whole box is filled with 10% of the hue, so severity is a
 *      surface rather than a line.
 *   4. **A border on all four sides.** Severity is not one edge of the box.
 *
 * Three deliberate omissions:
 *
 *   - **No live region unless asked.** A condition that was already true when the
 *     page opened is not an event, so the box declares no `role` and announces
 *     nothing. A notice that *is* the result of something the user just did may
 *     pass `role="status"`, and it then gets an accessible name from its own label
 *     and title.
 *   - **No dismissal unless given.** `onDismiss` renders the control, and a site
 *     that could be dismissed before still can. A persistent condition is not
 *     given one to keep the interface quiet.
 *   - **No copy of its own.** The words come from the site (and, where they exist,
 *     from `lib/`), so one condition cannot be two sentences on two pages.
 */

/** How much attention a notice claims. The hue is derived; it is never the only carrier. */
export type NoticeTone = "err" | "warn" | "ok" | "muted" | "pending";

/** Every tone, in severity order. Exported for the tests and for documentation. */
export const NOTICE_TONES: readonly NoticeTone[] = ["err", "warn", "ok", "muted", "pending"];

interface ToneStyle {
  /** The whole box: border on four sides, and a tint of the same hue. */
  readonly frame: string;
  /** The ink of the leading label. */
  readonly ink: string;
  /** The shape, which is the channel that survives colour blindness. */
  readonly icon: LucideIcon;
}

/**
 * Tone → the design system's own classes.
 *
 * The hues are `src/index.css`'s tokens, and this table is the only place in the
 * app that names one for a notice — so severity cannot be expressed by a call
 * site inventing a colour, and a palette change is one edit rather than a search.
 * The intensities follow the existing surfaces: `err`/`warn` at 50% of the hue on
 * the border and 10% on the fill, `ok` one step quieter because a confirmed
 * outcome should not shout, and `muted` in the world's own hairline.
 */
const TONE: Record<NoticeTone, ToneStyle> = {
  err: { frame: "border-err/50 bg-err/10", ink: "text-err", icon: OctagonAlert },
  warn: { frame: "border-warn/50 bg-warn/10", ink: "text-warn", icon: AlertTriangle },
  ok: { frame: "border-ok/40 bg-ok/10", ink: "text-ok", icon: Check },
  muted: { frame: "border-border bg-surface-raised/40", ink: "text-text-muted", icon: Info },
  pending: { frame: "border-accent/50 bg-accent/10", ink: "text-accent-muted", icon: Clock },
};

interface NoticeProps {
  /** Which severity this is. Decides the tint, the border, the ink and the shape. */
  tone: NoticeTone;
  /**
   * The severity in words — the leading line. Required, because a notice that
   * does not say what it is leans on its hue, which is the defect this replaces.
   * Where the site has a better word than the tone's own ("Not written" rather
   * than "Check this"), it passes that word instead.
   */
  label: string;
  /** Optional second line: what this condition is, when the label is its severity. */
  title?: ReactNode;
  /** The detail: the sentence, the facts, the controls the condition offers. */
  children?: ReactNode;
  /**
   * Set only when this notice is the report of something that just happened, and
   * therefore worth announcing. A condition already on the page at load passes
   * nothing and stays silent.
   */
  role?: "alert" | "status";
  /** Renders the dismiss control. Anything that could be dismissed before still is. */
  onDismiss?: () => void;
  /** Extra layout classes from the site — spacing, a measure. Never a colour. */
  className?: string;
}

export function Notice({
  tone,
  label,
  title,
  children,
  role,
  onDismiss,
  className = "",
}: NoticeProps) {
  const style = TONE[tone];
  const Icon = style.icon;

  return (
    <div
      // The tone is also a DOM fact, so a test asks the component rather than
      // matching a class that happens to look like severity.
      data-tone={tone}
      role={role}
      // The announced ones get a name from the word they lead with: a bare
      // `role="status"` is an unnamed region, and it would be announced by its
      // changed content alone.
      aria-label={role ? label : undefined}
      className={`rounded-lg border px-3 py-2 ${style.frame} ${className}`}
    >
      <p className={`flex items-start gap-1.5 text-sm font-medium ${style.ink}`}>
        <Icon size={14} aria-hidden className="mt-0.5 shrink-0" />
        {label}
      </p>
      {title && <p className="mt-1 text-sm leading-relaxed text-text">{title}</p>}
      {children && <div className="mt-1 flex flex-col gap-2">{children}</div>}
      {onDismiss && (
        <div className="mt-2">
          <Button
            variant="secondary"
            onClick={onDismiss}
            aria-label={`Dismiss: ${label}`}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
