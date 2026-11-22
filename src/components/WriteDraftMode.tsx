import { useId, useState } from "react";
import { Section } from "./Section";
import { Input } from "./ui/Input";
import { WriteDraftToTag } from "./WriteDraftToTag";
import { useDraftsState } from "./DraftsProvider";
import { draftDetail, draftTitle, filterDrafts } from "../lib/drafts";
import type { Draft } from "../lib/drafts";

interface WriteDraftModeProps {
  connected: boolean;
}

/** The label above a group, in the design system's voice. */
const LABEL = "text-[11px] uppercase tracking-[0.12em] text-text-muted";

/** One Draft in the list: its name over the facts that tell two names apart. */
const ROW =
  "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/**
 * The Write mode of 13.56 MHz: choose a Draft, then hand it to the write flow.
 *
 * Writing is one path out of the app and it starts from a Draft, so this mode is
 * a chooser in front of `WriteDraftToTag` rather than a second write flow. The
 * confirmation, the capacity check and the read-back that follows the write are
 * the ones that already put a Draft on a Tag, and they are used here unchanged —
 * a mode in front of an operation must not become a second implementation of it.
 *
 * The chooser is an in-app list rather than a native menu, because the library of
 * Drafts grows without a cap (ADR 0010): every Draft is visible at once, a search
 * field above the list narrows it by name, by id or by anything authored inside
 * its Records, and each row carries the count, the encoded size and the age that
 * tell two similarly named Drafts apart. The field only appears past one Draft,
 * where a list of one would be machinery around a single row.
 *
 * Nothing is preselected. A Tag receives one whole message and it replaces what
 * is there, so which Draft is going on the Tag is a choice the user makes before
 * the Tag is read, not a default the page makes for them. The choice is this
 * mode's own state, so leaving the mode forgets it: a Draft chosen for one Tag is
 * never silently written to the next.
 *
 * The queue itself belongs to the app (`DraftsProvider`), so a Draft composed in
 * Library is here without a reload, and a Draft written from this page is still
 * a Draft: writing one does not attach it to the Tag.
 */
export function WriteDraftMode({ connected }: WriteDraftModeProps) {
  const drafts = useDraftsState();
  const [chosenId, setChosenId] = useState<string>("");
  const [query, setQuery] = useState("");
  const groupLabelId = useId();
  const chosen = drafts.drafts.find((draft) => draft.id === chosenId) ?? null;

  if (drafts.loading) {
    return <p className="text-sm leading-relaxed text-text-muted">Reading the Drafts…</p>;
  }

  if (drafts.drafts.length === 0) {
    return (
      <Section
        title="No Drafts to write"
        hint="A Draft is an NDEF message composed before the Tag is in hand: Records in order, attached to no Tag."
      >
        <p className="max-w-prose text-sm leading-relaxed text-text-muted">
          Compose one in Library → Drafts, then come back here to write it to a Tag.
        </p>
        {drafts.error !== null && (
          <p className="mt-2 max-w-prose text-xs leading-relaxed text-err">{drafts.error}</p>
        )}
      </Section>
    );
  }

  const total = drafts.drafts.length;
  const matches = filterDrafts(drafts.drafts, query);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span id={groupLabelId} className={LABEL}>
          Draft to write
        </span>

        {total > 1 && (
          <Input
            value={query}
            onChange={setQuery}
            placeholder="Search name, id or content"
            aria-label="Search Drafts"
            className="max-w-sm"
          />
        )}

        {/* The list scrolls within a bounded height, so the write panel below it
            stays where it was however long the library grows. */}
        <div
          role="group"
          aria-labelledby={groupLabelId}
          className="flex max-h-[40vh] w-full max-w-sm flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1"
        >
          {matches.length === 0 ? (
            <p className="text-sm leading-relaxed text-text-muted">
              No Draft matches “{query.trim()}”.{" "}
              {total === 1 ? "There is 1 Draft." : `There are ${total} Drafts.`}
            </p>
          ) : (
            matches.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                chosen={draft.id === chosenId}
                onChoose={() => setChosenId(draft.id)}
              />
            ))
          )}
        </div>

        {drafts.error !== null && (
          <p className="max-w-prose text-xs leading-relaxed text-err">{drafts.error}</p>
        )}
      </div>

      {chosen !== null && <WriteDraftToTag records={chosen.records} connected={connected} />}
    </div>
  );
}

interface DraftRowProps {
  draft: Draft;
  /** Whether this is the Draft the user chose; it is never chosen for them. */
  chosen: boolean;
  onChoose: () => void;
}

/**
 * One Draft as a row of the list: the name on the line the eye lands on, and the
 * facts that distinguish it — its Record count, its encoded size and when it last
 * changed — beneath it.
 */
function DraftRow({ draft, chosen, onChoose }: DraftRowProps) {
  const name = draftTitle(draft);
  const detail = draftDetail(draft);
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={`${name} — ${detail}`}
      onClick={onChoose}
      className={`${ROW} ${chosen ? "bg-surface-raised" : "hover:bg-surface/60"}`}
    >
      <span className="w-full max-w-full truncate text-sm text-text">{name}</span>
      <span className="w-full max-w-full truncate text-[11px] text-text-muted">{detail}</span>
    </button>
  );
}
