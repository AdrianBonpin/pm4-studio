import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  PencilLine,
  RotateCcw,
  ScanLine,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Notice } from "./ui/Notice";
import { Segmented, type SegmentedOption } from "./ui/Segmented";
import { Toggle } from "./ui/Toggle";
import { Field, Readout, Section } from "./Section";
import {
  ReplacementConfirmation,
  replacementActionVariant,
} from "./ReplacementConfirmation";
import { beginDeviceOperation } from "../lib/deviceLock";
import {
  EMPTY_ENTRY,
  PART_FIELDS,
  PAYLOAD_FACT_LABEL,
  authorConfirmation,
  authorWriteNotice,
  canPreview,
  entryHint,
  normalizeHexInput,
  previewFacts,
  snapshotDuplicateNote,
  snapshotFailedNote,
  snapshotKeptNote,
  type AuthorEntry,
  type AuthorMode,
} from "../lib/authorIdentity";
import { classifyDeviceFailure, describeDeviceFailure } from "../lib/readerIdentity";
import { outcomes, report } from "../lib/outcome";
import {
  replacementConfirmation,
  type WritePosition,
} from "../lib/replacement";
import { NOTICE_TONE_CLASS, type NoticeTone } from "../lib/noticeTone";
import type { WriteNotice } from "../lib/writeOutcome";
import type { LibraryState } from "../hooks/useLibrary";
import type { IdentityPreview, LfCard, WriteResult } from "../types";

type Phase = "entry" | "confirm" | "reading" | "replacing" | "writing" | "done";

/**
 * The two ways to enter an Identity, in the order the switch offers them.
 *
 * They are a switch rather than a pair of buttons because they are the same
 * decision the band pages ask — exactly one of a handful of options, chosen in
 * place — so they are the same control, and a user learns it once.
 */
const ENTRY_OPTIONS: readonly SegmentedOption<AuthorMode>[] = [
  { value: "parts", label: "Customer, facility, card" },
  { value: "hex", label: "Five-byte hex" },
];

/** What a Snapshot save did. A repeat is neither a fault nor a success. */
type LibraryNote = { tone: NoticeTone; text: string };

interface AuthorIdentityProps {
  connected: boolean;
  /** Snapshots live in a file, so keeping one is a call into the Rust store. */
  library: LibraryState;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

/**
 * Author an Identity by hand and write it to a Blank.
 *
 * The flow is: type the values, **preview the exact Identity**, then write. The
 * preview is a real step rather than a live echo of the form, because the write
 * is irreversible on the Tag: the confirmation names the Identity, the fields it
 * came from, and the 24 bytes that will be sent, and it is produced before
 * anything goes to the device.
 *
 * Between the preview and the write there is one more step, and it exists because
 * the guard permits writing over a Tag carrying a **different** Identity: the Tag
 * in the write position is read, and the confirmation names *that* Identity as
 * well as the new one. A Tag that reads no Identity is said to read no Identity —
 * a Blank and an empty field look the same — and a Tag already carrying the
 * target is reported as refused rather than offered. `lib/replacement.ts` owns
 * that copy, and the Clone flow uses the same module, so the two cannot drift.
 *
 * Nothing here converts values into an Identity. That is the Rust codec's job
 * (`author_identity.rs` over `identity.rs`), reached through `lf_identity_preview`
 * and `lf_identity_preview_hex`, so the form and the decoder cannot disagree
 * about what a facility code is. This component only decides when to ask.
 *
 * The write itself is `lf_write`, the same guarded path the clone flow uses, so
 * ADR 0001 holds here too: a tag that cannot be read is refused, a tag already
 * carrying this Identity is refused, and neither refusal is a prompt. There is no
 * override in this component, and there is not meant to be one.
 */
export function AuthorIdentity({ connected, library, onDeviceError }: AuthorIdentityProps) {
  const [phase, setPhase] = useState<Phase>("entry");
  const [mode, setMode] = useState<AuthorMode>("parts");
  const [entry, setEntry] = useState<AuthorEntry>(EMPTY_ENTRY);
  const [preview, setPreview] = useState<IdentityPreview | null>(null);
  /** What the Tag in the write position read as, taken before the write is offered. */
  const [position, setPosition] = useState<WritePosition | null>(null);
  /** The codec's refusal, which names the field and the range it will hold. */
  const [entryError, setEntryError] = useState<string | null>(null);
  /** A Reader that could not be read at the confirmation step. */
  const [readError, setReadError] = useState<string | null>(null);
  const [keepSnapshot, setKeepSnapshot] = useState(false);
  const [result, setResult] = useState<WriteResult | null>(null);
  const [notice, setNotice] = useState<WriteNotice | null>(null);
  /** What keeping the Identity as a Snapshot did, if it was asked to. */
  const [snapshotNote, setSnapshotNote] = useState<LibraryNote | null>(null);
  const [busy, setBusy] = useState(false);

  const setField = useCallback((field: keyof AuthorEntry, value: string) => {
    setEntry((prev) => ({ ...prev, [field]: value }));
    setEntryError(null);
  }, []);

  const reset = useCallback(() => {
    setPhase("entry");
    setPreview(null);
    setPosition(null);
    setEntry(EMPTY_ENTRY);
    setEntryError(null);
    setReadError(null);
    setKeepSnapshot(false);
    setResult(null);
    setNotice(null);
    setSnapshotNote(null);
  }, []);

  /** Ask the codec what this entry means. Sends nothing and touches no Tag. */
  const askPreview = useCallback(async () => {
    setBusy(true);
    setEntryError(null);
    setReadError(null);
    try {
      const next =
        mode === "hex"
          ? await invoke<IdentityPreview>("lf_identity_preview_hex", {
              hex: normalizeHexInput(entry.hex),
            })
          : await invoke<IdentityPreview>("lf_identity_preview", {
              customer: entry.customer.trim(),
              facility: entry.facility.trim(),
              card: entry.card.trim(),
            });
      setPreview(next);
      setPosition(null);
      setPhase("confirm");
    } catch (e) {
      // The codec's refusal already names the field, what was entered and the
      // range; it is shown as it is rather than summarised into "invalid".
      setEntryError(String(e));
    } finally {
      setBusy(false);
    }
  }, [entry, mode]);

  /**
   * Read the Tag in the write position, so the confirmation can name what the
   * write will replace.
   *
   * Read-only: `lf_poll` sends the 125 kHz read command and nothing else, and the
   * device lock is held for it so the page's poller cannot interleave. Anything
   * other than a clean read is reported and the write is not offered — a Reader
   * that cannot answer is not a Blank.
   */
  const checkPosition = useCallback(async () => {
    setBusy(true);
    setReadError(null);
    setPhase("reading");
    const release = beginDeviceOperation();
    try {
      const card = await invoke<LfCard | null>("lf_poll");
      setPosition(card ? { kind: "identified", card } : { kind: "no-identity" });
      setPhase("replacing");
    } catch (e) {
      const text = describeDeviceFailure(e);
      setReadError(text);
      if (classifyDeviceFailure(String(e)) !== "unknown") onDeviceError?.(text);
      setPhase("confirm");
    } finally {
      release();
      setBusy(false);
    }
  }, [onDeviceError]);

  /** Save the Identity the read-back proved, in the same step as the write. */
  const keepInLibrary = useCallback(
    async (written: WriteResult) => {
      const readback = written.readback;
      if (!readback) {
        // A verified write always reads back; without one there is no Tag to
        // record, and inventing a Snapshot would claim more than was seen.
        setSnapshotNote({ tone: "warn", text: snapshotFailedNote(null) });
        return;
      }
      const saved = await library.saveLf(readback);
      if (!saved) {
        setSnapshotNote({ tone: "warn", text: snapshotFailedNote(library.error) });
        return;
      }
      const name = saved.snapshot?.name ?? readback.id;
      if (saved.outcome === "refused") {
        setSnapshotNote({
          tone: "warn",
          text: snapshotFailedNote(saved.library.problem?.message ?? null),
        });
        return;
      }
      setSnapshotNote(
        saved.outcome === "added"
          ? { tone: "ok", text: snapshotKeptNote(name) }
          : { tone: "muted", text: snapshotDuplicateNote(name) },
      );
    },
    [library],
  );

  const write = useCallback(
    async (target: IdentityPreview) => {
      setPhase("writing");
      setBusy(true);
      setSnapshotNote(null);
      try {
        const written = await invoke<WriteResult>("lf_write", {
          customer: target.customer,
          data32: target.data32,
        });
        setResult(written);
        setNotice(authorWriteNotice(written, target.id));
        // Whatever the write came to, in the write vocabulary's own words: a
        // verified write, a refusal the guard reported, a sent write the read-back
        // could not confirm, or a failure. One outcome, reported once, so the
        // notice beside the form and the message in the corner cannot disagree.
        report(outcomes.write("write", written));
        if (written.verified) {
          // One action: a kept Identity is saved from the read-back that proved
          // the write, so the Snapshot records what the Tag really holds.
          if (keepSnapshot) await keepInLibrary(written);
        }
      } catch (e) {
        // A wedged, absent or claimed Reader is reported with its remedy, never
        // as a write that happened.
        setNotice({ tone: "err", text: describeDeviceFailure(e) });
        report(outcomes.readerFailure(e));
      } finally {
        setBusy(false);
        setPhase("done");
      }
    },
    [keepSnapshot, keepInLibrary, onDeviceError],
  );

  const confirmation = preview ? authorConfirmation(preview, keepSnapshot) : null;
  const replacement =
    preview && position ? replacementConfirmation(preview, position) : null;
  const ready = canPreview(mode, entry);

  return (
    <Section
      title="Author an Identity"
      hint="Mint a credential from values you type, write it to a Blank, and optionally keep it as a Snapshot."
    >
      {phase === "entry" && (
        <div className="flex flex-col gap-5">
          <Segmented
            label="Identity entry"
            value={mode}
            options={ENTRY_OPTIONS}
            onChange={setMode}
          />

          {mode === "parts" ? (
            <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
              {PART_FIELDS.map((field) => (
                <label key={field.id} className="flex flex-col gap-1.5">
                  <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                    {field.label}
                  </span>
                  <Input
                    value={entry[field.id]}
                    placeholder={field.id === "card" ? "33298" : "0x55"}
                    aria-label={field.label}
                    onChange={(value) => setField(field.id, value)}
                  />
                  <span className="font-mono text-[11px] text-text-muted/70">{field.range}</span>
                </label>
              ))}
            </div>
          ) : (
            <label className="flex max-w-sm flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                Five-byte Identity
              </span>
              <Input
                value={entry.hex}
                placeholder="55 00 84 82 12"
                aria-label="Five-byte Identity"
                className="font-mono"
                onChange={(value) => setField("hex", value)}
              />
            </label>
          )}

          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            {entryHint(mode, entry)}
          </p>

          {entryError && (
            <p className="flex items-start gap-1.5 text-sm text-err">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="select-text">{entryError}</span>
            </p>
          )}

          <div>
            <Button variant="primary" disabled={!ready || busy} onClick={() => void askPreview()}>
              <PencilLine size={13} /> Preview the Identity
            </Button>
          </div>
        </div>
      )}

      {phase === "confirm" && preview && confirmation && (
        <div className="flex flex-col gap-4">
          <Readout value={confirmation.identity} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {previewFacts(preview)
              .filter((fact) => fact.label !== PAYLOAD_FACT_LABEL)
              .map((fact) => (
                <Field key={fact.label} label={fact.label} value={fact.value} />
              ))}
          </div>

          <details>
            <summary className="cursor-pointer text-[11px] uppercase tracking-[0.12em] text-text-muted hover:text-text">
              {PAYLOAD_FACT_LABEL}
            </summary>
            <code className="mt-2 block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
              {preview.payloadHex}
            </code>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              The 24 bytes sent to the Reader. Nothing has been written yet.
            </p>
          </details>

          <Notice tone="muted" label="Nothing written yet" title={confirmation.title}>
            <ul className="flex flex-col gap-2">
              {confirmation.facts.map((fact) => (
                <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
                  <span className="text-text">{fact.title}.</span> {fact.detail}
                </li>
              ))}
            </ul>
          </Notice>

          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            {confirmation.blankHint}
          </p>

          <label className="flex items-center gap-3">
            <Toggle
              checked={keepSnapshot}
              onChange={setKeepSnapshot}
              label="Keep as a Snapshot"
              disabled={busy}
            />
            <span className="text-sm text-text-muted">
              Keep as a Snapshot in one action
              <span className="ml-1 text-xs text-text-muted/70">
                — saved from the read-back that proves the write.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!connected || busy}
              onClick={() => void checkPosition()}
            >
              <ScanLine size={13} /> {confirmation.action}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPhase("entry")}>
              <X size={13} /> Change the values
            </Button>
          </div>
          {readError && (
            <p className="flex items-start gap-1.5 text-sm text-err">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="select-text">{readError}</span>
            </p>
          )}
          {!connected && (
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <WifiOff size={12} /> Connect the Reader to write this Identity.
            </p>
          )}
        </div>
      )}

      {phase === "reading" && (
        <p className="text-sm text-text-muted">
          Reading the tag on the reader, so the confirmation can name what this write would
          replace…
        </p>
      )}

      {phase === "replacing" && preview && replacement && (
        <div className="flex flex-col gap-4">
          <ReplacementConfirmation confirmation={replacement} />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={replacementActionVariant(replacement.destructive)}
              disabled={!connected || busy || replacement.alreadyCarries}
              onClick={() => void write(preview)}
            >
              <PencilLine size={13} /> {replacement.action}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void checkPosition()}>
              <ScanLine size={13} /> Read the tag again
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPhase("confirm")}>
              <X size={13} /> Back
            </Button>
          </div>
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Nothing has been written yet. The Reader reads the tag again immediately before
            writing and refuses one it cannot read, so a tag taken off the reader is refused
            rather than written blind. That re-read does not know which Identity you consented
            to: check that the tag described above is the one you mean to overwrite.
          </p>
        </div>
      )}

      {phase === "writing" && (
        <p className="text-sm text-text-muted">
          Writing <span className="font-mono text-text">{confirmation?.identity}</span> to the tag
          on the reader…
        </p>
      )}

      {phase === "done" && (
        <div className="flex flex-col gap-3">
          {notice && (
            <p className={`flex items-start gap-1.5 text-sm ${NOTICE_TONE_CLASS[notice.tone]}`}>
              {notice.tone === "ok" ? (
                <Check size={15} className="mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              )}
              <span className="select-text">{notice.text}</span>
            </p>
          )}

          {snapshotNote && (
            <p
              className={`flex items-start gap-1.5 text-xs ${NOTICE_TONE_CLASS[snapshotNote.tone]}`}
            >
              <BookmarkPlus size={12} className="mt-0.5 shrink-0" />
              <span className="select-text">{snapshotNote.text}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {preview && result?.outcome !== "verified" && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  // Another attempt means another reading: the Tag on the reader
                  // may not be the one the last confirmation named.
                  setPosition(null);
                  setReadError(null);
                  setPhase("confirm");
                }}
              >
                <PencilLine size={13} /> Try this Identity again
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={reset}>
              <RotateCcw size={13} /> Author a new Identity
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
