import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Copy as CopyIcon, ScanLine } from "lucide-react";
import { Button } from "./ui/Button";
import { Readout, Section } from "./Section";
import { beginDeviceOperation } from "../lib/deviceLock";
import { decodeHfPayload } from "../lib/hfDecoder";
import { hfReadOutcome, readHfOnce, type HfRead } from "../lib/hfRead";
import {
  copyDecision,
  copyDestination,
  copyEvidence,
  copyOutcome,
  copySource,
  messageBytes,
  observeField,
  requiredBytes,
  type CopyDecision,
  type CopyDestination,
  type CopyFit,
  type CopyMessage as HeldMessage,
} from "../lib/hfCopy";
import { recordLine } from "../lib/tagRecords";
import { recordsLabel, type NdefWriteResult } from "../lib/tagWrite";
import { NOTICE_TONE_CLASS } from "../lib/writeOutcome";
import { report, outcomes } from "../lib/outcome";
import type { TagRecordsRead } from "../lib/tagRecords";
import type { HfCard } from "../types";

type Phase =
  | "idle"
  | "reading-source"
  | "source-held"
  | "checking-field"
  | "awaiting-destination"
  | "reading-destination"
  | "confirm"
  | "writing"
  | "done";

interface CopyMessageProps {
  connected: boolean;
  onPoll: () => Promise<HfCard | null>;
}

/**
 * Copy a whole NDEF message from one 13.56 MHz Tag onto another.
 *
 * This is Copy, not Clone. A Clone puts one 125 kHz Identity onto a Blank and is
 * confirmed by comparing an Identity; a Copy replaces another Tag's whole NDEF
 * message and is confirmed by comparing the decoded Records in order together
 * with their total encoded length. The two verify differently and keep different
 * names.
 *
 * The flow exists to protect the Tag it is reading from, so it refuses to be
 * hurried:
 *
 *   1. read the source and hold the message;
 *   2. take the source off the Reader, and check that **no tag is latched** — the
 *      source must not be in the write position when anything is written;
 *   3. read the destination and show what will be replaced, with its size;
 *   4. weigh the message against the destination's known capacity, or say that
 *      the fit is unknown and proceed only on a ticked acknowledgement;
 *   5. write, read back, and compare the decoded Records in order and their
 *      encoded length;
 *   6. report one outcome, which sounds.
 *
 * Every decision is made in `lib/hfCopy.ts`, which is pure and has a test for
 * each branch; this component sequences the device calls and renders the answer.
 * The write half is not a second write path: it calls the same `hf_ndef_write`
 * the Write mode uses, which reads → plans → sends → reads back → classifies, and
 * the confirmation below is the only place Copy can reach it.
 */
export function CopyMessage({ connected, onPoll }: CopyMessageProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [held, setHeld] = useState<HeldMessage | null>(null);
  const [destination, setDestination] = useState<CopyDestination | null>(null);
  const [fit, setFit] = useState<CopyFit | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [decision, setDecision] = useState<CopyDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy =
    phase === "reading-source" ||
    phase === "checking-field" ||
    phase === "reading-destination" ||
    phase === "writing";

  /** Report a decision, when it is one: a step that proceeds says nothing. */
  const reportDecision = (next: CopyDecision): void => {
    const outcome = copyOutcome(next);
    if (outcome !== null) report(outcome);
    setDecision(next);
  };

  const reset = () => {
    setPhase("idle");
    setHeld(null);
    setDestination(null);
    setFit(null);
    setAcknowledged(false);
    setDecision(null);
    setError(null);
  };

  /**
   * One poll and, when the poll names a Tag that can carry a message, the message
   * read that follows. A Reader failure is reported here and answered with null,
   * because there is then no reading to hold and no Tag to judge.
   */
  const readTag = async (): Promise<HfRead | null> => {
    try {
      return await readHfOnce({ poll: onPoll, records: recordsRead });
    } catch (failure) {
      report(outcomes.readerFailure(failure));
      return null;
    }
  };

  /** 1. Read the source Tag and hold its message. */
  const readSource = async () => {
    setError(null);
    setDecision(null);
    setDestination(null);
    setFit(null);
    setAcknowledged(false);
    setPhase("reading-source");
    const release = beginDeviceOperation();
    try {
      const read = await readTag();
      if (read === null) {
        setPhase("idle");
        return;
      }
      // The source read is a complete read of the source Tag, so it reports the
      // read's own outcome. Holding a message is the whole point of the step.
      report(hfReadOutcome(read));
      const message = copySource(read);
      if (message === null) {
        // The read said why in the message it reported; there is nothing to hold.
        setPhase("idle");
        return;
      }
      setHeld(message);
      setPhase("source-held");
    } finally {
      release();
    }
  };

  /** 2. Observe the field: nothing may be latched before the destination goes on. */
  const checkField = async () => {
    if (held === null) return;
    setError(null);
    setDecision(null);
    setPhase("checking-field");
    const release = beginDeviceOperation();
    try {
      let card: HfCard | null;
      try {
        card = await onPoll();
      } catch (failure) {
        report(outcomes.readerFailure(failure));
        setPhase("source-held");
        return;
      }
      const field = observeField(card === null ? null : decodeHfPayload(card.payload));
      const next = copyDecision({ step: "source-removed", source: held, field });
      if (next.kind === "proceed") {
        // Nothing is in the field. That is not a result, so it sounds nothing.
        setPhase("awaiting-destination");
        return;
      }
      reportDecision(next);
      // Stay on this step: the source is still held, and the same button can be
      // pressed again once the tag has been taken off.
      setPhase("source-held");
    } finally {
      release();
    }
  };

  /** 3 and 4. Read the destination, then let the guard weigh what it holds. */
  const readDestination = async () => {
    if (held === null) return;
    setError(null);
    setDecision(null);
    setAcknowledged(false);
    setPhase("reading-destination");
    const release = beginDeviceOperation();
    try {
      const read = await readTag();
      if (read === null) {
        setPhase("awaiting-destination");
        return;
      }
      const readDestination = copyDestination(read);
      setDestination(readDestination);
      const next = copyDecision({
        step: "destination",
        source: held,
        destination: readDestination,
        acknowledgedUnknownFit: false,
      });
      if (next.kind === "proceed") {
        // A confirmation is a question, not a result: it makes no sound.
        setFit(next.fit);
        setPhase("confirm");
        return;
      }
      if (
        next.kind === "refused" &&
        next.refusal.condition === "fit-unknown-unacknowledged"
      ) {
        // Not a dead end: the confirmation stays, with the acknowledgement the
        // specification requires before an unmeasured fit may be written.
        setFit({ kind: "unknown", requiredBytes: requiredBytes(held) });
        setPhase("confirm");
        reportDecision(next);
        return;
      }
      reportDecision(next);
      setPhase("awaiting-destination");
    } finally {
      release();
    }
  };

  /** The acknowledgement is the only thing that turns an unknown fit into a write. */
  const acknowledge = (checked: boolean) => {
    setAcknowledged(checked);
    if (held === null || destination === null) return;
    const next = copyDecision({
      step: "destination",
      source: held,
      destination,
      acknowledgedUnknownFit: checked,
    });
    if (next.kind === "proceed") {
      setFit(next.fit);
      setDecision(null);
    }
  };

  /** 5 and 6. Write through the one NDEF write path, then judge the read-back. */
  const copyToTag = async () => {
    if (held === null || destination === null) return;
    setError(null);
    setPhase("writing");
    const release = beginDeviceOperation();
    try {
      const written = await invoke<NdefWriteResult>("hf_ndef_write", {
        messageHex: held.messageHex,
      });
      const next = copyDecision({
        step: "write",
        source: held,
        previous: destination.message,
        evidence: copyEvidence(written),
      });
      reportDecision(next);
      setPhase("done");
    } catch (failure) {
      report(outcomes.readerFailure(failure));
      setError(failure instanceof Error ? failure.message : String(failure));
      setPhase("confirm");
    } finally {
      release();
    }
  };

  const destinationRecords =
    destination !== null && destination.message !== null ? destination.message.records : [];
  const destinationBytes =
    destination !== null && destination.message !== null ? messageBytes(destination.message) : 0;
  const unknownFit = fit?.kind === "unknown";

  return (
    <Section
      title="Copy a message to another tag"
      hint="13.56 MHz only. Reads one tag's whole NDEF message, then writes it to a second tag. The source is taken off the Reader before anything is written, and the copy is confirmed by reading the destination back."
      actions={
        held === null ? (
          <Button variant="primary" disabled={!connected || busy} onClick={() => void readSource()}>
            <ScanLine size={13} /> {phase === "reading-source" ? "Reading…" : "Read source tag"}
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={reset}>
            Start again
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {!connected && (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Connect the Reader to copy a message. Both tags are read and the destination is
            written, so this cannot be prepared without it.
          </p>
        )}

        {error && (
          <p className="border-l-2 border-err bg-err/5 px-3 py-2 text-xs leading-relaxed text-err">
            {error}
          </p>
        )}

        {held === null && phase === "idle" && (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Read the source tag first. Its message is held, nothing is written until you have
            taken it off the Reader, read the destination, and confirmed what will be replaced.
          </p>
        )}

        {held !== null && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                Source message held
              </span>
              <span className="font-mono text-[11px] text-text-muted">
                {recordsLabel(held.records)} · {messageBytes(held)} bytes
              </span>
            </div>
            <Readout value={held.uid} />
            <ol className="flex flex-col gap-1">
              {held.records.map((record, at) => (
                <li key={at} className="font-mono text-[11px] leading-relaxed text-text-muted">
                  {at + 1}. {recordLine(record)}
                </li>
              ))}
            </ol>
          </div>
        )}

        {held !== null && (phase === "source-held" || phase === "checking-field") && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="max-w-prose text-sm leading-relaxed text-text">
              Take the source tag off the Reader, then check the field.
            </p>
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              The check has to find nothing latched. Writing with the source still in the write
              position is the one mistake this step exists to stop.
            </p>
            <div>
              <Button
                variant="secondary"
                disabled={!connected || busy}
                onClick={() => void checkField()}
              >
                <ScanLine size={13} />{" "}
                {phase === "checking-field" ? "Checking…" : "Check the field"}
              </Button>
            </div>
          </div>
        )}

        {held !== null && (phase === "awaiting-destination" || phase === "reading-destination") && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="max-w-prose text-sm leading-relaxed text-text">
              Nothing is latched. Put the destination tag on the Reader and read it.
            </p>
            <div>
              <Button
                variant="secondary"
                disabled={!connected || busy}
                onClick={() => void readDestination()}
              >
                <ScanLine size={13} />{" "}
                {phase === "reading-destination" ? "Reading…" : "Read destination tag"}
              </Button>
            </div>
          </div>
        )}

        {(phase === "confirm" || phase === "writing") && destination !== null && fit !== null && (
          <div className="flex flex-col gap-2 border-l-2 border-warn bg-warn/5 px-3 py-2">
            <p className="flex items-center gap-1.5 text-sm text-warn">
              <AlertTriangle size={14} /> Replace what tag {destination.uid ?? "unknown"} holds?
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-text">
              Copying writes {recordsLabel(held?.records ?? [])} onto this tag, replacing what it
              holds now: {recordsLabel(destinationRecords)}, {destinationBytes}{" "}
              {destinationBytes === 1 ? "byte" : "bytes"}.
            </p>
            {destinationRecords.length > 0 && (
              <ol className="flex flex-col gap-1">
                {destinationRecords.map((record, at) => (
                  <li key={at} className="font-mono text-[11px] leading-relaxed text-text-muted">
                    {at + 1}. {recordLine(record)}
                  </li>
                ))}
              </ol>
            )}
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              {fitSentence(fit)}
            </p>
            {unknownFit && (
              <label className="flex items-start gap-2 text-xs leading-relaxed text-text">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={(event) => acknowledge(event.target.checked)}
                />
                <span>
                  Write anyway, knowing the fit is unknown. The tag may be too small, and a
                  message that does not fit is not written in part.
                </span>
              </label>
            )}
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              The source tag is already off the Reader. Keep the destination on it until the
              result appears; polling is suspended while the write runs.
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button
                variant="danger"
                disabled={!connected || busy || (unknownFit && !acknowledged)}
                onClick={() => void copyToTag()}
              >
                <CopyIcon size={13} /> {phase === "writing" ? "Copying…" : "Copy to this tag"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {decision !== null && decision.kind !== "proceed" && (
          <CopyNotice decision={decision} />
        )}

        {phase === "done" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={reset}>
              Copy another message
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

/** One decision, in its own words, with the symbol that says which it is. */
function CopyNotice({
  decision,
}: {
  decision: Extract<CopyDecision, { kind: "result" | "refused" | "failed" | "nothing-latched" }>;
}) {
  if (decision.kind === "nothing-latched") {
    return (
      <div className="border-l-2 border-border bg-surface-raised/40 px-3 py-2">
        <p className="text-sm text-text-muted">{decision.message}</p>
        <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">
          {decision.detail}
        </p>
      </div>
    );
  }

  const verified = decision.kind === "result" && decision.verification === "verified";
  const tone = verified ? "ok" : decision.kind === "result" ? "warn" : "err";
  const heading = verified ? "Copied" : decision.kind === "result" ? "Unconfirmed" : "Not copied";
  const message = decision.kind === "refused" ? decision.refusal.message : decision.message;
  const detail = decision.kind === "refused" ? decision.refusal.detail : decision.detail;

  return (
    <div
      className={`border-l-2 px-3 py-2 ${
        tone === "ok" ? "border-ok bg-ok/5" : tone === "warn" ? "border-warn bg-warn/5" : "border-err bg-err/5"
      }`}
    >
      <p className={`flex items-center gap-1.5 text-sm ${NOTICE_TONE_CLASS[tone]}`}>
        {tone === "ok" ? <Check size={14} /> : <AlertTriangle size={14} />}
        {heading}
      </p>
      <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-text">{message}</p>
      {detail !== null && (
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">{detail}</p>
      )}
    </div>
  );
}

/** How the message weighs against the destination, in one sentence. */
function fitSentence(fit: CopyFit): string {
  if (fit.kind === "known") {
    return `The message needs ${fit.requiredBytes} of this tag's ${fit.capacityBytes} bytes. A write replaces the whole message; nothing is appended.`;
  }
  return `This tag's capacity could not be determined, so whether the message's ${fit.requiredBytes} bytes fit is unknown.`;
}

/** The message read that follows a poll: the one `0x0081` transaction, once. */
function recordsRead(): Promise<TagRecordsRead> {
  return invoke<TagRecordsRead>("ntag_records_read", {
    capturedAt: new Date().toISOString(),
  });
}
