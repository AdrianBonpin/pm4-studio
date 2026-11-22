import { Notice, type NoticeTone } from "./ui/Notice";
import { Readout } from "./Section";
import type { ReplacementConfirmation as ReplacementConfirmationData } from "../lib/replacement";

/**
 * The one rendering of a write confirmation.
 *
 * The wording comes from `lib/replacement.ts`, which both paths that can destroy
 * an Identity use — authoring by hand and cloning onto what the user believes is
 * a Blank. This module is the second half of that: the markup, once.
 *
 * It exists because the markup used to be copied into `AuthorIdentity` and
 * `CloneWizard` and the copies drifted. The clone path hardcoded the warn frame
 * and ignored `destructive`, so the higher-risk sentence — "you are overwriting a
 * different tag" — got the milder treatment of the two, and a user shown the calm
 * version of a destructive write learns that the alarm means nothing. So the
 * styling here is a function of `destructive` and of nothing else: neither path
 * can express its own opinion about how serious its write is.
 *
 * **The two cases differ in words, not only in hue.** `replacementTone` names the
 * tone each case is drawn in, and the notice leads with that word beside its own
 * shape, so a user who cannot tell amber from grey still reads which of the two
 * they are looking at: "Check this" when something is destroyed, and "Nothing to
 * replace" when nothing is known to be.
 *
 * **This is a condition, not an outcome.** A confirmation the user has not answered
 * is a state the page is in, so it has no `Outcome` and no severity in the seam
 * (ADR 0008: conditions stay inline, and the toast model draws events). The tone
 * below is therefore presentation — the ink this condition is drawn in — chosen
 * here, once, for both callers; it makes no sound and produces no message in the
 * corner.
 */

/** How a confirmation reads, decided by `destructive` alone. */
export interface ReplacementTone {
  /** The tone the notice is drawn in. Presentation for a condition, not a severity. */
  readonly tone: NoticeTone;
  /** That tone in words — the notice's leading line. */
  readonly label: string;
}

export function replacementTone(destructive: boolean): ReplacementTone {
  return destructive
    ? { tone: "warn", label: "Check this" }
    : { tone: "muted", label: "Nothing to replace" };
}

/**
 * The variant of the button that sends the write. Exported so both callers ask
 * the same question rather than each writing `destructive ? "danger" : "primary"`
 * and one of them eventually writing something else.
 */
export function replacementActionVariant(destructive: boolean): "danger" | "primary" {
  return destructive ? "danger" : "primary";
}

interface ReplacementConfirmationProps {
  /** The confirmation built by `lib/replacement.ts`; `destructive` is part of it. */
  confirmation: ReplacementConfirmationData;
}

export function ReplacementConfirmation({ confirmation }: ReplacementConfirmationProps) {
  const tone = replacementTone(confirmation.destructive);
  return (
    <div className="flex flex-col gap-4">
      <Readout value={confirmation.identity} />
      <Notice tone={tone.tone} label={tone.label} title={confirmation.title}>
        <ul className="flex flex-col gap-2">
          {confirmation.facts.map((fact) => (
            <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
              <span className="text-text">{fact.title}.</span> {fact.detail}
            </li>
          ))}
        </ul>
      </Notice>
    </div>
  );
}
