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
import { NOTICE_TONE_CLASS, NOTICE_TONES, type NoticeTone } from "../../lib/noticeTone";

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
 * screenshot with the bar cropped off lost it too. So a notice now carries its
 * tone through four channels at once:
 *
 *   1. **A word.** `label` is required and in the tone's ink. "Check this", "Not
 *      written", "Saving is off". It is the channel that needs no eyesight for
 *      colour and no cropping.
 *   2. **A shape.** Each tone has its own icon: an octagon, a triangle, a tick, a
 *      circle, a clock. Distinct silhouettes, so the tone survives colour
 *      blindness. It is `aria-hidden`, because the words already say it and a
 *      screen reader reading "warning warning" helps nobody.
 *   3. **A tint.** The whole box is filled with 10% of the hue, so a notice's tone
 *      is a surface rather than a line.
 *   4. **A border on all four sides.** A tone is not one edge of the box.
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

/**
 * The tone vocabulary and the ink per tone are `lib/noticeTone`'s, and this module
 * re-exports them so a site draws a notice with one import. There is exactly one
 * `NoticeTone` in the app: the type is defined once, and the class that realises
 * each tone as text colour is `NOTICE_TONE_CLASS`, also once.
 */
export type { NoticeTone };
export { NOTICE_TONES };

interface ToneStyle {
  /** The whole box: border on four sides, and a tint of the same hue. */
  readonly frame: string;
  /** The shape, which is the channel that survives colour blindness. */
  readonly icon: LucideIcon;
}

/**
 * Tone → the box this app draws it in: the frame on four sides and the shape of
 * the icon. The hue's *ink* is `lib/noticeTone`'s `NOTICE_TONE_CLASS`, so a tone's
 * colour is named once for the whole app; this table adds what only a box needs,
 * and a call site passes a tone, never a colour.
 *
 * The frame is named in two places, and this is one of them: `ui/ToastViewport`
 * draws a message's border from the same hues at `warn/50`, `ok/40` and `err/60`,
 * where a notice draws `warn/50`, `ok/40` and `err/50`. The intensities differ by
 * **surface**, not by severity, and the reason is what the two things are. A notice
 * sits in the page's own flow, on the canvas, with a 10% tint of its hue behind it,
 * so a half-strength edge is enough to close the box. A message floats over
 * whatever the user was reading, its card is `bg-surface/95` rather than a tint, so
 * its edge has to carry the hue alone against any background — and `err`, the one
 * that must survive being read past, is a step firmer for it.
 *
 * The rest follows the existing surfaces: `err`/`warn` at 50% of the hue on the
 * border and 10% on the fill, `ok` one step quieter at 40% because a confirmed
 * outcome should not shout, and `muted` in the world's own hairline.
 */
const TONE: Record<NoticeTone, ToneStyle> = {
  err: { frame: "border-err/50 bg-err/10", icon: OctagonAlert },
  warn: { frame: "border-warn/50 bg-warn/10", icon: AlertTriangle },
  ok: { frame: "border-ok/40 bg-ok/10", icon: Check },
  muted: { frame: "border-border bg-surface-raised/40", icon: Info },
  pending: { frame: "border-accent/50 bg-accent/10", icon: Clock },
};

interface NoticeProps {
  /**
   * The tone: how much attention this condition claims. It decides the tint, the
   * border, the ink and the shape — and it is a tone, not the seam's severity,
   * because a condition has no outcome to read a severity from (see
   * `lib/noticeTone`).
   */
  tone: NoticeTone;
  /**
   * The tone in words — the leading line. Required, because a notice that does
   * not say what it is leans on its hue, which is the defect this replaces.
   * Where the site has a better word than the tone's own ("Not written" rather
   * than "Check this"), it passes that word instead.
   */
  label: string;
  /** Optional second line: what this condition is, when the label is its tone. */
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
  const ink = NOTICE_TONE_CLASS[tone];
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
      <p className={`flex items-start gap-1.5 text-sm font-medium ${ink}`}>
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
