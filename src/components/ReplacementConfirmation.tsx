import { AlertTriangle } from "lucide-react";
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
 */

/** How a confirmation reads, decided by `destructive` alone. */
export interface ReplacementTone {
  /** The block's border and fill. */
  readonly frame: string;
  /** The heading's colour. */
  readonly title: string;
  /** Whether the warning icon is shown. */
  readonly icon: boolean;
}

export function replacementTone(destructive: boolean): ReplacementTone {
  return destructive
    ? { frame: "border-warn bg-warn/5", title: "text-warn", icon: true }
    : { frame: "border-border bg-surface/40", title: "text-text", icon: false };
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
      <div className={`border-l-2 px-3 py-2 ${tone.frame}`}>
        <p className={`flex items-center gap-1.5 text-sm ${tone.title}`}>
          {tone.icon && <AlertTriangle size={14} />} {confirmation.title}
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {confirmation.facts.map((fact) => (
            <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
              <span className="text-text">{fact.title}.</span> {fact.detail}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
