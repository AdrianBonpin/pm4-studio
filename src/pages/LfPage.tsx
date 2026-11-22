import { useCallback, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Segmented, type SegmentedOption } from "../components/ui/Segmented";
import { AuthorIdentity } from "../components/AuthorIdentity";
import { BatchMode } from "../components/BatchMode";
import { ClearTag } from "../components/ClearTag";
import { CloneWizard } from "../components/CloneWizard";
import { Field, Readout, Section } from "../components/Section";
import { useLfPoller } from "../hooks/useReader";
import { useSessionMode } from "../hooks/useSessionMode";
import { hex } from "../lib/library";
import { outcomes, report } from "../lib/outcome";
import { saveNoteOf, type SaveNote } from "../lib/saveNote";
import { SaveNoteLine } from "../components/SaveNoteLine";
import {
  LF_FIRST_MODE,
  LF_MODES,
  LF_MODE_KEY,
  type LfMode,
  type LfModeOption,
} from "../lib/lfModes";
import type { LibraryState } from "../hooks/useLibrary";
import type { LfCard } from "../types";

/**
 * The five operations, in the order the work happens, as the switch shows them.
 *
 * The names are `lib/lfModes`', not this page's: the mode's name and the panel's
 * own heading are the same name, and a test binds them so they cannot drift apart
 * the way "Reset" and "Blank a tag" once did, and the way the mode then named the
 * destructive operation a user reached for by habit.
 */
const MODES: readonly SegmentedOption<LfMode>[] = LF_MODES.map((option: LfModeOption) => ({
  value: option.id,
  label: option.label,
}));

/** Re-exported for the pages and tests that name a mode. */
export type { LfMode };

interface LfPageProps {
  connected: boolean;
  /** Snapshots live in a file, so saving is a call into the Rust store. */
  library: LibraryState;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

/**
 * The 125 kHz page: five operations, one at a time.
 *
 * It used to be five stacked sections, so reaching the fifth meant scrolling
 * past four and the guided Clone came first even though reading is the thing it
 * depends on. Now the page is a workspace: a switcher names Read,
 * Write, Clear, Clone and Batch in that order, and the one you choose is the
 * only one on screen. That is what removes the scroll, and it is also what lets
 * each operation be named, entered and reported on its own.
 *
 * Read opens first because it is the base capability and the precondition every
 * write depends on. The mode is remembered for the session (`useSessionMode`),
 * so checking something in the Library and coming back does not cost your place.
 *
 * The section that only pointed at the Library destination is gone: Library is a
 * destination in the shell, and the last thing on this page is an operation.
 *
 * The operations themselves are unchanged and still carry their own gates. That
 * is deliberate — ADR 0001's refuses (a tag that cannot be read, a tag already
 * presenting the Identity) live in the Rust guard, and the confirmation that
 * names what a write destroys is shared by the two write paths. Moving a panel
 * into a mode changes where it renders, not what it asks.
 *
 * Leaving a mode unmounts it, and that includes any confirmation in progress. It
 * is the safer of the two behaviours: a confirmation is about the tag that was on
 * the Reader a moment ago, and carrying one across a mode switch — or worse,
 * across a page — would be the stale consent ADR 0001 exists to prevent.
 */
export function LfPage({ connected, library, onDeviceError }: LfPageProps) {
  const [mode, setMode] = useSessionMode<LfMode>(LF_MODE_KEY, LF_FIRST_MODE);

  return (
    <div className="flex flex-col gap-6">
      <Segmented
        label="125 kHz operation"
        value={mode}
        options={MODES}
        onChange={setMode}
      />

      {mode === "read" && (
        <ReadMode connected={connected} library={library} onDeviceError={onDeviceError} />
      )}

      {mode === "write" && (
        <AuthorIdentity
          connected={connected}
          library={library}
          onDeviceError={onDeviceError}
        />
      )}

      {mode === "clear" && (
        <ClearTag connected={connected} onDeviceError={onDeviceError} />
      )}

      {mode === "clone" && (
        <CloneMode connected={connected} library={library} onDeviceError={onDeviceError} />
      )}

      {mode === "batch" && (
        <BatchMode connected={connected} onDeviceError={onDeviceError} />
      )}
    </div>
  );
}

/**
 * Read: one action, then the Identity large.
 *
 * The Identity is the display value, because that is the thing compared with a
 * printout or a door; the decoded facility and card sit beside it as the two
 * halves a credential is usually spoken in. The raw payload is one `<details>`
 * away rather than in the way: verifying a decode you do not trust should cost a
 * click, not a screenful on every read.
 *
 * Saving is part of the read, not a separate trip: one button records the
 * Snapshot and says what happened to it. The note is this panel's own, so a save
 * from the Clone flow cannot appear under a different read.
 */
function ReadMode({ connected, library, onDeviceError }: LfPageProps) {
  const [reading, setReading] = useState(false);
  const [current, setCurrent] = useState<LfCard | null>(null);
  const { note, save } = useLibrarySave(library);

  useLfPoller(
    reading,
    connected,
    (card) => {
      setCurrent(card);
      setReading(false);
      // The reading is the operation the user started: one latched Tag, one
      // outcome, one message and one sound. The messages the Reader answers
      // while it is merely being polled report nothing.
      report(outcomes.tagRead("read", card.id));
    },
    onDeviceError,
  );

  return (
    <Section
      title="Read a tag"
      hint="Inspect whatever 125 kHz Tag is on the Reader."
      actions={
        <Button
          variant={reading ? "secondary" : "primary"}
          disabled={!connected}
          onClick={() => setReading((v) => !v)}
        >
          {reading ? "Stop" : "Read tag"}
        </Button>
      }
    >
      {current ? (
        <div className="flex flex-col gap-5">
          <Readout value={current.id} />

          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Field label="Facility" value={String(current.facility)} />
            <Field label="Card" value={String(current.card)} />
            <Field label="Customer" value={`0x${hex(current.customer, 2)}`} />
            <Field label="data32" value={`0x${hex(current.data32, 8)}`} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void save(current)}>
              <BookmarkPlus size={13} /> Save to library
            </Button>
            <SaveNoteLine note={note} />
          </div>

          <details>
            <summary className="cursor-pointer text-[11px] uppercase tracking-[0.12em] text-text-muted hover:text-text">
              Raw payload
            </summary>
            <code className="mt-2 block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
              {current.raw}
            </code>
          </details>
        </div>
      ) : (
        <Readout placeholder={reading ? "Listening for a tag…" : "No tag read yet."} />
      )}
    </Section>
  );
}

/**
 * Clone: the guided wizard, with the reading it produces savable in one action.
 *
 * The wizard owns the flow; the page owns the library, so the save is passed in
 * and its note is shown here rather than inside the wizard, which has no
 * business knowing what a Snapshot is.
 */
function CloneMode({ connected, library, onDeviceError }: LfPageProps) {
  const { note, save } = useLibrarySave(library);

  return (
    <Section
      title="Clone a tag"
      hint="Guided copy from an original tag onto a Blank, with a verified read-back."
    >
      <CloneWizard
        connected={connected}
        onSaved={save}
        onDeviceError={onDeviceError}
      />
      <SaveNoteLine note={note} />
    </Section>
  );
}

/**
 * Keep one read in the library, and what that came to.
 *
 * One outcome per save, reported and then read back with `saveNoteOf` — the same
 * derivation the 13.56 MHz page uses, so the two pages cannot word or colour the
 * same answer differently. Each panel gets its own instance, because the note
 * belongs to the read that was saved.
 */
function useLibrarySave(library: LibraryState): {
  note: SaveNote | null;
  save: (card: LfCard) => Promise<void>;
} {
  const [note, setNote] = useState<SaveNote | null>(null);

  const save = useCallback(
    async (card: LfCard) => {
      const result = await library.saveLf(card);
      // The store's own answer, or the call's failure: never silence, and never
      // two different sentences for the line and the message in the corner.
      const answer =
        result === null
          ? outcomes.librarySaveFailed(library.error ?? "")
          : outcomes.librarySaved(result);
      report(answer);
      setNote(saveNoteOf(answer));
    },
    [library],
  );

  return { note, save };
}
