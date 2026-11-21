import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/Button";
import { Section } from "./Section";
import { beginDeviceOperation } from "../lib/deviceLock";
import { outcomes, report } from "../lib/outcome";
import type { DraftRecord } from "../lib/drafts";
import { NdefError } from "../lib/ndef";
import {
  capacitySentence,
  draftMessageHex,
  pageRange,
  pagesLabel,
  replacementSentence,
  writeNotice,
  type NdefPreview,
  type NdefWriteResult,
} from "../lib/tagWrite";
import { NOTICE_TONE_CLASS } from "../lib/writeOutcome";

interface WriteDraftToTagProps {
  /**
   * The Records to write, in order: a Draft's or a Snapshot's. Writing either is
   * the same operation — one complete NDEF message, one confirmation, one
   * read-back — so this component does not branch on where they came from.
   */
  records: readonly DraftRecord[];
  connected: boolean;
  /**
   * The Snapshot these Records came from, when they came from one. It is the
   * write's provenance and nothing else: a verified write counts one confirmed
   * copy on that Snapshot, and a write that is not verified counts nothing. A
   * Draft names no Snapshot and has no count, because it is attached to no Tag.
   */
  snapshotId?: string;
  /** What the Records belong to, in the copy. */
  subject?: "Draft" | "Snapshot";
  /** Called when a write changed the confirmed-copy count, so the list reloads. */
  onCountChanged?: () => void;
}

type Phase = "idle" | "reading" | "confirm" | "writing";

/**
 * Write one set of Records to the 13.56 MHz Tag on the Reader, as one complete
 * NDEF message.
 *
 * The Records are a Draft's or a Snapshot's, and the operation is the same
 * either way (the spec: "writing a Draft to a tag and writing a Snapshot's
 * Records to a tag are the same operation with different provenance"). The
 * provenance is `snapshotId`: when the Records came from a Snapshot, a verified
 * write counts a confirmed copy on it, and a write that is not verified counts
 * nothing.
 *
 * The flow is deliberately two steps. "Check tag" reads the Tag and asks the
 * backend what a write would do; only then is there a confirmation, and that
 * confirmation names the message the Tag holds now — or says the Tag appears
 * empty. Nothing is written by the first step: it sends the info and memory read
 * commands only.
 *
 * A write holds the device lock for its whole duration, so the 125 kHz poller
 * cannot put a question to the Reader in the middle of it.
 */
export function WriteDraftToTag({
  records,
  connected,
  snapshotId,
  subject = "Draft",
  onCountChanged,
}: WriteDraftToTagProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<NdefPreview | null>(null);
  const [result, setResult] = useState<NdefWriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "reading" || phase === "writing";
  const holdsNothing = records.length === 0;

  /** These Records as one NDEF message in hex, or the reason this build cannot encode them. */
  const encode = (): string | null => {
    try {
      return draftMessageHex(records);
    } catch (e) {
      setError(e instanceof NdefError ? e.message : String(e));
      return null;
    }
  };

  const check = async () => {
    setError(null);
    setResult(null);
    setPreview(null);
    const messageHex = encode();
    if (messageHex === null) return;

    setPhase("reading");
    const release = beginDeviceOperation();
    try {
      setPreview(await invoke<NdefPreview>("hf_ndef_preview", { messageHex }));
      setPhase("confirm");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    } finally {
      release();
    }
  };

  const write = async () => {
    setError(null);
    const messageHex = encode();
    if (messageHex === null) return;

    setPhase("writing");
    const release = beginDeviceOperation();
    try {
      const written = await invoke<NdefWriteResult>("hf_ndef_write", {
        messageHex,
        // `null` rather than an absent key: the backend reads this as "no
        // Snapshot", which is exactly what a Draft is.
        snapshotId: snapshotId ?? null,
      });
      setResult(written);
      setPreview(null);
      // The write is the operation the user confirmed, so it reports itself. One
      // outcome in `lib/tagWrite`'s own words, so the notice beside the result and
      // the message in the corner cannot disagree about what landed.
      report(outcomes.ndefWrite(written));
      // Only a count that actually moved makes the library stale.
      if (written.countChanged) onCountChanged?.();
    } catch (e) {
      setError(String(e));
      // A Reader that could not send the write is its own news, with its own
      // remedy — never a write that did not land.
      report(outcomes.readerFailure(e));
    } finally {
      release();
      setPhase("idle");
    }
  };

  const cancel = () => {
    setPreview(null);
    setError(null);
    setPhase("idle");
  };

  const notice = result ? writeNotice(result) : null;
  const messageHex = (() => {
    try {
      return draftMessageHex(records);
    } catch {
      return null;
    }
  })();

  return (
    <Section
      title="Write to a tag"
      hint={`13.56 MHz only. The ${subject}'s Records are written as one complete NDEF message: a write replaces what the tag holds, and nothing is appended.`}
      actions={
        <Button
          variant="primary"
          disabled={!connected || busy || holdsNothing}
          onClick={() => void check()}
        >
          {phase === "reading" ? "Reading tag…" : "Check tag"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {!connected && (
          <p className="text-xs leading-relaxed text-text-muted">
            Connect the Reader to write this {subject === "Draft" ? "Draft" : "Snapshot"}.{" "}
            {subject === "Draft"
              ? "The Draft itself needs no Reader, which is why it can be composed first."
              : "The Snapshot itself needs no Reader, which is why it can be reviewed months later."}
          </p>
        )}

        {holdsNothing && (
          <p className="text-xs leading-relaxed text-text-muted">
            This {subject} holds no Records, so there is no message to write. A write of nothing
            is refused rather than sent.
          </p>
        )}

        {error && (
          <p className="border-l-2 border-err bg-err/5 px-3 py-2 text-xs leading-relaxed text-err">
            {error}
          </p>
        )}

        {preview && !preview.fits && (
          <div className="border-l-2 border-err bg-err/5 px-3 py-2">
            <p className="text-sm text-err">Not written</p>
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">
              {preview.refusal ?? "the write would be refused"}.
            </p>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">
              {capacitySentence(preview)}
            </p>
            <div className="mt-2">
              <Button variant="secondary" onClick={cancel}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {preview && preview.fits && (
          <div className="border-l-2 border-warn bg-warn/5 px-3 py-2">
            <p className="text-sm text-warn">
              Replace the message on the tag with this {subject}?
            </p>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-text">
              {replacementSentence(preview)}
            </p>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">
              {capacitySentence(preview)}
            </p>
            {preview.tag && (
              <p className="mt-1 font-mono text-[11px] text-text-muted">
                tag {preview.tag.uid} · {pagesLabel(pageRange(preview.requiredBytes))} of user
                memory
              </p>
            )}
            {messageHex && (
              <code className="mt-2 block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-[11px] leading-relaxed text-accent-muted">
                {messageHex}
              </code>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void write()}>
                {phase === "writing" ? "Writing…" : "Write to tag"}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={cancel}>
                Cancel
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
              Keep the tag on the Reader until the result appears. Polling is suspended while
              the write runs.
            </p>
          </div>
        )}

        {notice && result && (
          <div
            className={`border-l-2 px-3 py-2 ${
              notice.tone === "ok"
                ? "border-ok bg-ok/5"
                : notice.tone === "warn"
                  ? "border-warn bg-warn/5"
                  : "border-err bg-err/5"
            }`}
          >
            <p className={`text-sm ${NOTICE_TONE_CLASS[notice.tone]}`}>
              {notice.tone === "ok"
                ? "Verified"
                : notice.tone === "warn"
                  ? "Unconfirmed"
                  : "Not written"}
            </p>
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">
              {notice.text}
            </p>
            <p className="mt-1 font-mono text-[11px] text-text-muted">
              {result.after
                ? `reads back ${result.after.existing.state} · ${result.after.existing.bytes} ${
                    result.after.existing.bytes === 1 ? "byte" : "bytes"
                  }`
                : "no read-back"}
              {" · "}
              {pagesLabel(result.acceptedPages)} reported written
            </p>
            <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-text-muted">
              {subject === "Draft"
                ? "A Draft is not attached to any Tag, so it is still here and can be written to another tag."
                : "A Snapshot records what a Tag held when it was read, so writing its Records to another Tag leaves it exactly as it was."}
            </p>
            {result.countProblem && (
              <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-err">
                The confirmed-copy count could not be saved: {result.countProblem}
              </p>
            )}
          </div>
        )}

        {!preview && !notice && !error && !holdsNothing && (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Check the tag first: the Reader reads it and reports what a write would replace,
            and how the message fits. Nothing is written until you confirm.
          </p>
        )}

        {preview?.tag && !preview.fits && (
          <p className="font-mono text-[11px] text-text-muted">tag {preview.tag.uid}</p>
        )}
      </div>
    </Section>
  );
}
