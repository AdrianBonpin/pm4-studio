import { useState } from "react";
import { Section } from "./Section";
import { Select } from "./ui/Select";
import { WriteDraftToTag } from "./WriteDraftToTag";
import { useDraftsState } from "./DraftsProvider";
import { draftDetail, draftTitle } from "../lib/drafts";

interface WriteDraftModeProps {
  connected: boolean;
}

/**
 * The Write mode of 13.56 MHz: choose a Draft, then hand it to the write flow.
 *
 * Writing is one path out of the app and it starts from a Draft, so this mode is
 * a chooser in front of `WriteDraftToTag` rather than a second write flow. The
 * confirmation, the capacity check and the read-back that follows the write are
 * the ones that already put a Draft on a Tag, and they are used here unchanged —
 * a mode in front of an operation must not become a second implementation of it.
 *
 * Nothing is preselected. A Tag receives one whole message and it replaces what
 * is there, so which Draft is going on the Tag is a choice the user makes before
 * the Tag is read, not a default the page makes for them.
 *
 * The queue itself belongs to the app (`DraftsProvider`), so a Draft composed in
 * Library is here without a reload, and a Draft written from this page is still
 * a Draft: writing one does not attach it to the Tag.
 */
export function WriteDraftMode({ connected }: WriteDraftModeProps) {
  const drafts = useDraftsState();
  const [chosenId, setChosenId] = useState<string>("");
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
          Draft to write
        </span>
        <Select
          label="Draft to write"
          prompt="Choose a Draft"
          value={chosenId}
          options={drafts.drafts.map((draft) => ({
            value: draft.id,
            label: draftTitle(draft),
          }))}
          onChange={setChosenId}
          className="max-w-sm"
        />
        {chosen !== null && (
          <p className="text-xs leading-relaxed text-text-muted">{draftDetail(chosen)}</p>
        )}
        {drafts.error !== null && (
          <p className="max-w-prose text-xs leading-relaxed text-err">{drafts.error}</p>
        )}
      </div>

      {chosen !== null && <WriteDraftToTag records={chosen.records} connected={connected} />}
    </div>
  );
}
