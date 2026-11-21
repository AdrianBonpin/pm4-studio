import { READER_CAPABILITY_LIMITS } from "../lib/readerIdentity";
import { Section } from "./Section";

/**
 * The Reader's capability limits, rendered from the one list that defines them.
 *
 * This is the single place these limits are stated. Do not repeat an entry
 * against an individual Tag: an unavailable field on a Tag is this hardware's
 * limit, not that Tag's, and a per-tag wall of "unavailable" rows is the thing
 * this component exists to prevent.
 */
export function ReaderLimits() {
  return (
    <Section
      title="Capability limits"
      hint="Stated here once. These are limits of this Reader's firmware and protocol, not failures of the Tag in front of it."
    >
      <dl className="flex flex-col gap-4">
        {READER_CAPABILITY_LIMITS.map((limit) => (
          <div key={limit.id} className="flex flex-col gap-1">
            <dt className="font-heading text-xs text-text">{limit.label}</dt>
            <dd className="text-xs leading-relaxed text-text-muted">{limit.detail}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
