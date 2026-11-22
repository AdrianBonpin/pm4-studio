import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CopyMessage } from "../components/CopyMessage";
import { useDraftsState } from "../components/DraftsProvider";
import { EraseNdef } from "../components/EraseNdef";
import { MemoryDumpPanel } from "../components/MemoryDumpPanel";
import { WriteDraftMode } from "../components/WriteDraftMode";
import { Badge, type BadgeTone } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Segmented } from "../components/ui/Segmented";
import { Field, Readout, Section } from "../components/Section";
import { variantsNote } from "../lib/cardType";
import { HF_MODES, type HfMode } from "../lib/hfWorkspace";
import {
  hexBytes,
  ndefField,
  type HfRawOnlyReason,
  type HfReading,
} from "../lib/hfDecoder";
import {
  hfReadOutcome,
  readHfOnce,
  type HfMessage,
  type HfMessageState,
  type HfRead,
} from "../lib/hfRead";
import { draftNameFromRead } from "../lib/drafts";
import { hfSnapshotSave } from "../lib/hfSnapshot";
import { report, outcomes } from "../lib/outcome";
import { saveNoteOf, type SaveNote } from "../lib/saveNote";
import { SaveNoteLine } from "../components/SaveNoteLine";
import type { LibraryState } from "../hooks/useLibrary";
import type { TagRecordsRead } from "../lib/tagRecords";
import type { HfCard } from "../types";

interface HfPageProps {
  connected: boolean;
  onPoll: () => Promise<HfCard | null>;
  /**
   * The mode on show, held by the shell so that leaving the page for another
   * destination and coming back returns to the mode the user left. The page is a
   * leaf: it owns the reading, not the navigation.
   */
  mode: HfMode;
  onModeChange: (mode: HfMode) => void;
  /** Snapshots live in a file, so keeping a read is a call into the Rust store. */
  library: LibraryState;
  /**
   * Open a Draft in Library's Drafts collection. The shell owns the
   * destination, so it is told which Draft to show rather than navigating from
   * here; the page owns the Draft itself, because the press is the operation.
   */
  onOpenDraft: (draftId: string) => void;
}

/**
 * The action a readout with Records offers: turn this message into a Draft.
 *
 * It is handed to the message half rather than sitting in the panel's header
 * beside Save to library, because it belongs to the Records: a header action
 * would be there on a readout whose Records could not be fetched, where there is
 * nothing to copy.
 */
interface DraftAction {
  readonly busy: boolean;
  /** Set when the library file cannot be written, with the reason to show. */
  readonly locked: string | null;
  readonly run: () => void;
}

/** Short label per fallback reason. The sentence under it says what happened. */
const REASON_LABEL: Record<HfRawOnlyReason, string> = {
  "invalid-bytes": "unreadable reply",
  "unexpected-length": "unexpected length",
  "not-latched": "nothing latched",
  "empty-uid": "no UID in reply",
  "unsupported-uid-width": "unexpected UID length",
  "unknown-card-type": "unknown card type",
};

/**
 * How each message-state that is *not* a list of Records presents itself.
 *
 * The badge and its sentence are decided here rather than inline in the markup so
 * every state gets one, and so "there are no Records because the Tag holds none"
 * cannot be styled like "the Records could not be read" — that difference is the
 * whole point of the section.
 */
const MESSAGE_STATE: Record<
  Exclude<HfMessageState, "records" | "undecoded-reply" | "nothing-latched">,
  { label: string; tone: BadgeTone }
> = {
  "empty-message": { label: "empty message", tone: "muted" },
  "no-ndef-tlv": { label: "no message", tone: "muted" },
  "not-formatted": { label: "not NDEF formatted", tone: "muted" },
  "not-ndef-capable": { label: "not NDEF capable", tone: "muted" },
  undecodable: { label: "undecodable message", tone: "warn" },
  unreadable: { label: "unreadable message", tone: "warn" },
  "read-failed": { label: "records not read", tone: "warn" },
  "other-tag": { label: "different tag", tone: "warn" },
};

/**
 * The raw payload. Shown for every reading — decoded, raw-only or empty — because
 * the bytes are the record of what the Reader actually said.
 */
function RawPayload({ raw }: { raw: string }) {
  const bytes = raw === "" ? 0 : raw.split(" ").length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
          Raw payload
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {bytes} {bytes === 1 ? "byte" : "bytes"}
        </span>
      </div>
      <code className="block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
        {raw === "" ? "(empty payload)" : raw}
      </code>
    </div>
  );
}

/** A reply that could not be decoded: the bytes and the reason, no fields. */
function RawOnlyReadout({ reading }: { reading: Extract<HfReading, { state: "raw" }> }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-text-muted">Not decoded</span>
        <Badge label={REASON_LABEL[reading.reason]} tone="warn" />
      </div>
      <p className="max-w-prose text-sm leading-relaxed text-text-muted">{reading.detail}</p>
      <p className="max-w-prose text-xs leading-relaxed text-text-muted">
        No message read was attempted, because there is no decoded UID to match one against.
      </p>
      <RawPayload raw={reading.raw} />
    </div>
  );
}

/** One Record as a row: position, kind, summary, encoded size and validity. */
function RecordsTable({ message }: { message: HfMessage }) {
  const invalid = message.rows.filter((row) => !row.valid);
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-canvas">
        <table className="min-w-full text-[11px] leading-relaxed">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.12em] text-text-muted">
              <th scope="col" className="px-3 py-2 text-left font-normal">
                #
              </th>
              <th scope="col" className="px-2 py-2 text-left font-normal">
                kind
              </th>
              <th scope="col" className="px-2 py-2 text-left font-normal">
                summary
              </th>
              <th scope="col" className="px-2 py-2 text-right font-normal">
                size
              </th>
              <th scope="col" className="px-3 py-2 text-right font-normal">
                valid
              </th>
            </tr>
          </thead>
          <tbody>
            {message.rows.map((row) => (
              <tr key={row.position} className="border-t border-border/60">
                <td className="whitespace-nowrap px-3 py-1 font-mono text-text-muted">
                  {row.position}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-text">{row.kind}</td>
                <td className="px-2 py-1 font-mono text-accent-muted">
                  {row.summary === "" ? "—" : row.summary}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-right font-mono text-text-muted">
                  {row.bytes === null ? "—" : `${row.bytes} B`}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-1 text-right ${
                    row.valid ? "text-text-muted" : "text-warn"
                  }`}
                >
                  {row.valid ? "yes" : "no"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invalid.length > 0 && (
        <div className="flex flex-col gap-1">
          {invalid.map((row) => (
            <p
              key={row.position}
              className="max-w-prose text-xs leading-relaxed text-warn"
            >
              Record {row.position} cannot be encoded again by this build: {row.problem}
            </p>
          ))}
        </div>
      )}
      <p className="max-w-prose text-xs leading-relaxed text-text-muted">{message.note}</p>
    </div>
  );
}

/**
 * The message half: the Records as rows, or the honest reason there are none.
 *
 * `draft` is offered only where there are Records: on a readout whose message
 * could not be read, or which holds none, there is nothing to copy, so the action
 * is absent rather than disabled. An absent control is the honest rendering of an
 * operation with no subject.
 */
function MessageSection({ message, draft }: { message: HfMessage; draft: DraftAction }) {
  if (message.state === "records") {
    return (
      <div className="flex flex-col gap-3">
        <RecordsTable message={message} />
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="secondary"
            disabled={draft.busy || draft.locked !== null}
            title={draft.locked ?? "Copy this message into a Draft you can edit"}
            onClick={draft.run}
          >
            {draft.busy ? "Creating Draft…" : "Edit as Draft"}
          </Button>
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Copies this message into a new Draft, named after the Tag, and opens it in Library.
            The Tag is not written to.
          </p>
        </div>
      </div>
    );
  }
  if (message.state === "undecoded-reply" || message.state === "nothing-latched") return null;

  const state = MESSAGE_STATE[message.state];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
          Records
        </span>
        <Badge label={state.label} tone={state.tone} />
      </div>
      <p className="max-w-prose text-sm leading-relaxed text-text-muted">{message.note}</p>
      {message.reason !== null && message.state !== "read-failed" && (
        <p className="max-w-prose select-text break-words text-xs leading-relaxed text-text-muted">
          {message.reason}
        </p>
      )}
    </div>
  );
}

/** One resolved reading, and everything the two transactions settled about it. */
function HfReadout({ read, draft }: { read: HfRead; draft: DraftAction }) {
  if (read.reading === null) {
    return <Readout placeholder="No tag in the field." />;
  }
  if (read.reading.state === "raw") {
    return <RawOnlyReadout reading={read.reading} />;
  }

  const reading = read.reading;
  const { cardType } = reading;
  const capacity = read.capacityBytes === null ? "not determined" : `${read.capacityBytes} bytes`;
  // The poll cannot say whether the Tag is NDEF formatted; a memory read of the
  // same Tag can. Without one the row is omitted rather than greyed out.
  const ndefRow = ndefField(read.ndef);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Readout value={reading.uid} />
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Field label="Card type" value={cardType.family} />
        <Field
          label="Capacity"
          value={capacity}
          tone={read.capacityBytes === null ? "muted" : "default"}
        />
        <Field label="ATQA" value={hexBytes(reading.atqa)} />
        <Field label="SAK" value={hexBytes([reading.sak])} />
        <div className="col-span-2 sm:col-span-4">
          <Field label="Technologies" value={cardType.technologies.join("  ·  ")} />
        </div>
        <Field
          label="NFC Forum type"
          value={cardType.nfcForumTagType === null ? "none" : `Type ${cardType.nfcForumTagType}`}
          tone={cardType.nfcForumTagType === null ? "muted" : "default"}
        />
        {ndefRow && <Field label={ndefRow.label} value={ndefRow.value} />}
      </div>

      {cardType.variants.length > 1 && (
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          {variantsNote(cardType.variants)}
        </p>
      )}

      <p className="max-w-prose text-xs leading-relaxed text-text-muted">{read.ndef.note}</p>

      <MessageSection message={read.message} draft={draft} />

      <RawPayload raw={reading.raw} />
    </div>
  );
}

/**
 * The 13.56 MHz page: a workspace of modes, one visible at a time.
 *
 * The operations come before troubleshooting. Read, Write, Erase and Memory are
 * one click each, in the order the work is done (`lib/hfWorkspace.ts` owns that
 * order, and the slot Copy will take), so nothing is reached by scrolling past
 * something else. The page keeps the reading, not the mode: a read taken in Read
 * is the same reading the Memory mode shows the bytes of, and switching modes to
 * look at it does not throw it away.
 *
 * Two things are deliberately absent. The password panel is gone — half a screen
 * of explanation in front of two controls that can never work on this Reader —
 * and the one password fact that matters is recorded with the capability limits
 * in Settings → Diagnostics. No capability limit is repeated here either: the
 * limits are stated once, in the place that answers "why can this Reader not do
 * that".
 *
 * Read is **one action**: it polls the field and, when the poll produced a Tag
 * whose family can carry a message, reads that message in the same operation.
 * The two transactions are separate and either can fail, so the readout always
 * shows what was obtained and says why anything is missing
 * (`lib/hfRead.ts` owns that decision). Exactly one outcome is reported for the
 * whole action, so the sound and the message cannot disagree.
 *
 * Editing what a Tag holds no longer begins with a trip to another page: a
 * readout that has Records offers *Edit as Draft*, which copies them into a Draft
 * and opens it in Library's Drafts collection. The action is offered only where
 * there is something to copy, it writes nothing to the Tag, and it reports its
 * own outcome like every other operation.
 */
export function HfPage({
  connected,
  onPoll,
  mode,
  onModeChange,
  library,
  onOpenDraft,
}: HfPageProps) {
  const drafts = useDraftsState();
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [read, setRead] = useState<HfRead | null>(null);
  const [polled, setPolled] = useState(false);
  /** What keeping this read in the library came to. */
  const [saveNote, setSaveNote] = useState<SaveNote | null>(null);
  const [saving, setSaving] = useState(false);
  /** The memory dump the Memory mode shows: the read's own dump, or one taken
   *  there, without rewriting the reading on the Read mode. */
  const [dumpRead, setDumpRead] = useState<TagRecordsRead | null>(null);

  const readTag = async () => {
    setBusy(true);
    // A new read is a new thing to save, so the last read's save line goes.
    setSaveNote(null);
    try {
      let result: HfRead;
      try {
        // One read, in the order the work happens: poll, then the message read
        // the poll makes possible (`readHfOnce` owns that sequence so Copy's two
        // reads cannot drift from this one).
        result = await readHfOnce({ poll: onPoll, records: recordsRead });
      } catch (error) {
        // The Reader itself failed; that is the whole outcome and there is no
        // reading to show beside it.
        report(outcomes.readerFailure(error));
        setPolled(true);
        return;
      }
      setPolled(true);
      setRead(result);
      // Keep the dump panel on the same read, so the bytes and the readout are
      // one transaction's evidence rather than two that might disagree.
      setDumpRead(result.memory);
      report(hfReadOutcome(result));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Keep this read, in one action.
   *
   * The save is its own operation with its own outcome: a read can succeed and
   * the file still refuse to be written, and neither answer is the other. What
   * is saved is the whole reading — identity, family, capacity, NDEF status, the
   * raw reply and the Records in order — because a Snapshot is the record of one
   * read and half a record would be a different claim (`lib/hfSnapshot`).
   */
  const saveToLibrary = async () => {
    if (read === null) return;
    const request = hfSnapshotSave(read);
    if (request === null) return;
    setSaving(true);
    const result = await library.saveHf(request);
    setSaving(false);
    // The store's own answer, or the call's failure — never silence, and never
    // the same line for a repeat read and a refused file.
    const answer =
      result === null
        ? outcomes.librarySaveFailed(library.error ?? "")
        : outcomes.librarySaved(result);
    report(answer);
    setSaveNote(saveNoteOf(answer));
  };

  /**
   * The message on the readout becomes a Draft, and the user lands in it.
   *
   * One press, one Draft: the Records go over as they were read, in the Tag's
   * order, and they are already in it when it is created (`createWith`), so there
   * is never an empty Draft on disk under the reading's name. Nothing here reads
   * or writes the Tag — the Draft is this machine's own file — so the action
   * cannot modify the Tag it came from.
   *
   * It reports its own outcome, like every other operation on this page, because
   * the press is one: a success sounds the same done chirp everything else does,
   * and a library file that would not take the Draft is reported as the failure
   * it is rather than as a silent no-op.
   */
  const editAsDraft = async () => {
    const half = read?.message;
    const reading = read?.reading;
    // The action is only rendered where there are Records, so this guard is the
    // render condition restated rather than a state a user can reach.
    if (half === undefined || half.state !== "records") return;
    if (reading === null || reading === undefined || reading.state !== "decoded") return;

    setDrafting(true);
    try {
      const created = await drafts.createWith(draftNameFromRead(reading.uid), [...half.records]);
      if (created === null) {
        report(outcomes.draftNotCreated());
        return;
      }
      report(outcomes.draftedFromRead(reading.uid, half.records.length));
      onOpenDraft(created.id);
    } finally {
      setDrafting(false);
    }
  };

  const savable = read !== null && hfSnapshotSave(read) !== null;

  // The library file's own state, in the action's terms: a Draft cannot be
  // written to a file that will not be written, and the control says so.
  const draftLocked =
    drafts.problem === null
      ? null
      : "The library file cannot be written to, so a Draft cannot be saved";

  return (
    <div className="flex flex-col gap-8">
      <Segmented
        label="13.56 MHz mode"
        value={mode}
        options={HF_MODES.map((option) => ({ value: option.id, label: option.label }))}
        onChange={onModeChange}
      />

      {mode === "read" && (
        <Section
          title="Read a tag"
          hint="13.56 MHz ISO14443-A. One action: poll the Tag, then read its NDEF message."
          actions={
            <>
              <Button
                variant="secondary"
                disabled={!savable || saving || busy}
                title={
                  savable
                    ? undefined
                    : "Nothing decoded has been read yet, so there is no Tag to save."
                }
                onClick={() => void saveToLibrary()}
              >
                {saving ? "Saving…" : "Save to library"}
              </Button>
              <Button
                variant="primary"
                disabled={!connected || busy}
                onClick={() => void readTag()}
              >
                {busy ? "Reading…" : "Read tag"}
              </Button>
            </>
          }
        >
          {read === null ? (
            <Readout placeholder={polled ? "No tag in the field." : "No tag read yet."} />
          ) : (
            <HfReadout
              read={read}
              draft={{ busy: drafting, locked: draftLocked, run: () => void editAsDraft() }}
            />
          )}
          <SaveNoteLine note={saveNote} className="mt-3" />
        </Section>
      )}

      {mode === "write" && <WriteDraftMode connected={connected} />}

      {mode === "copy" && <CopyMessage connected={connected} onPoll={onPoll} />}

      {mode === "erase" && <EraseNdef connected={connected} />}

      {mode === "memory" && (
        <MemoryDumpPanel connected={connected} read={dumpRead} onRead={setDumpRead} />
      )}
    </div>
  );
}

/** The message read that follows a poll: the one `0x0081` transaction, once. */
function recordsRead(): Promise<TagRecordsRead> {
  return invoke<TagRecordsRead>("ntag_records_read", {
    capturedAt: new Date().toISOString(),
  });
}


