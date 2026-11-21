import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  PencilLine,
  RotateCcw,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Toggle } from "./ui/Toggle";
import { Field, Readout, Section } from "./Section";
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
import { NOTICE_TONE_CLASS, type WriteNotice } from "../lib/writeOutcome";
import type { LibraryState } from "../hooks/useLibrary";
import type { IdentityPreview, WriteResult } from "../types";

type Phase = "entry" | "confirm" | "writing" | "done";

/** What a Snapshot save did. A repeat is neither a fault nor a success. */
type LibraryNote = { tone: "ok" | "muted" | "warn" | "err"; text: string };

const LIBRARY_NOTE_TONE: Record<LibraryNote["tone"], string> = {
  ok: "text-ok",
  muted: "text-text-muted",
  warn: "text-warn",
  err: "text-err",
};

interface AuthorIdentityProps {
  connected: boolean;
  onChirp: () => void;
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
export function AuthorIdentity({ connected, onChirp, library, onDeviceError }: AuthorIdentityProps) {
  const [phase, setPhase] = useState<Phase>("entry");
  const [mode, setMode] = useState<AuthorMode>("parts");
  const [entry, setEntry] = useState<AuthorEntry>(EMPTY_ENTRY);
  const [preview, setPreview] = useState<IdentityPreview | null>(null);
  /** The codec's refusal, which names the field and the range it will hold. */
  const [entryError, setEntryError] = useState<string | null>(null);
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
    setEntry(EMPTY_ENTRY);
    setEntryError(null);
    setKeepSnapshot(false);
    setResult(null);
    setNotice(null);
    setSnapshotNote(null);
  }, []);

  /** Ask the codec what this entry means. Sends nothing and touches no Tag. */
  const askPreview = useCallback(async () => {
    setBusy(true);
    setEntryError(null);
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
      setPhase("confirm");
    } catch (e) {
      // The codec's refusal already names the field, what was entered and the
      // range; it is shown as it is rather than summarised into "invalid".
      setEntryError(String(e));
    } finally {
      setBusy(false);
    }
  }, [entry, mode]);

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
        if (written.verified) {
          onChirp();
          // One action: a kept Identity is saved from the read-back that proved
          // the write, so the Snapshot records what the Tag really holds.
          if (keepSnapshot) await keepInLibrary(written);
        }
      } catch (e) {
        // A wedged, absent or claimed Reader is reported with its remedy, never
        // as a write that happened.
        const text = describeDeviceFailure(e);
        setNotice({ tone: "err", text });
        if (classifyDeviceFailure(String(e)) !== "unknown") onDeviceError?.(text);
      } finally {
        setBusy(false);
        setPhase("done");
      }
    },
    [keepSnapshot, keepInLibrary, onChirp, onDeviceError],
  );

  const confirmation = preview ? authorConfirmation(preview, keepSnapshot) : null;
  const ready = canPreview(mode, entry);

  return (
    <Section
      title="Author an Identity"
      hint="Mint a credential from values you type, write it to a Blank, and optionally keep it as a Snapshot."
    >
      {phase === "entry" && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <ModeTab active={mode === "parts"} onClick={() => setMode("parts")}>
              Customer, facility, card
            </ModeTab>
            <ModeTab active={mode === "hex"} onClick={() => setMode("hex")}>
              Five-byte hex
            </ModeTab>
          </div>

          {mode === "parts" ? (
            <div className="grid gap-4 sm:grid-cols-3">
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
            <label className="flex flex-col gap-1.5">
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

          <div className="border-l-2 border-border bg-surface/40 px-3 py-2">
            <p className="text-sm text-text">{confirmation.title}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {confirmation.facts.map((fact) => (
                <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
                  <span className="text-text">{fact.title}.</span> {fact.detail}
                </li>
              ))}
            </ul>
          </div>

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
            <Button variant="primary" disabled={!connected || busy} onClick={() => void write(preview)}>
              <PencilLine size={13} /> {confirmation.action}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPhase("entry")}>
              <X size={13} /> Change the values
            </Button>
          </div>
          {!connected && (
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <WifiOff size={12} /> Connect the Reader to write this Identity.
            </p>
          )}
        </div>
      )}

      {phase === "writing" && (
        <p className="text-sm text-text-muted">
          Reading the tag on the reader, then writing{" "}
          <span className="font-mono text-text">{confirmation?.identity}</span>…
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
              className={`flex items-start gap-1.5 text-xs ${LIBRARY_NOTE_TONE[snapshotNote.tone]}`}
            >
              <BookmarkPlus size={12} className="mt-0.5 shrink-0" />
              <span className="select-text">{snapshotNote.text}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {preview && result?.outcome !== "verified" && (
              <Button variant="secondary" disabled={busy} onClick={() => setPhase("confirm")}>
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

/** One of the two ways to enter an Identity. A tab, not a toggle: it is a mode. */
function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-accent/50 bg-accent/10 text-text"
          : "border-border text-text-muted hover:border-border-hover hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
