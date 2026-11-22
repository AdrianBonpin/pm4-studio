import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Eraser, ScanLine } from "lucide-react";
import { Button } from "./ui/Button";
import { Notice } from "./ui/Notice";
import { Field, Readout, Section } from "./Section";
import { beginDeviceOperation } from "../lib/deviceLock";
import {
  eraseConfirmation,
  eraseNotice,
  erasedPagesLabel,
  type NdefErasePreview,
} from "../lib/eraseTag";
import { outcomes, report } from "../lib/outcome";
import type { EraseResult } from "../types";

type Phase = "idle" | "reading" | "confirm" | "erasing";

interface EraseNdefProps {
  connected: boolean;
}

/**
 * Erase a 13.56 MHz Tag's NDEF content so the Tag can be reused.
 *
 * Two deliberate steps, the same shape as writing a Draft: "Check tag" reads the
 * Tag and asks the backend what an erase would clear, and only then is there a
 * confirmation naming the Records that would be lost. Nothing is cleared by the
 * first step: it sends the info and memory read commands only.
 *
 * The wording keeps the one distinction this feature exists for. Erasing clears
 * CONTENT: the Tag keeps its UID, its Capability Container and its format, and
 * can be written again. It is not a format, not a lock, and not a way to remove
 * password protection — each of those is stated rather than left implied.
 *
 * The device lock is held for the whole of each operation, so the 125 kHz poller
 * cannot put a question to the Reader in the middle of it.
 */
export function EraseNdef({ connected }: EraseNdefProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<NdefErasePreview | null>(null);
  const [result, setResult] = useState<EraseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "reading" || phase === "erasing";

  const check = async () => {
    setError(null);
    setResult(null);
    setPreview(null);
    setPhase("reading");
    const release = beginDeviceOperation();
    try {
      setPreview(await invoke<NdefErasePreview>("hf_ndef_erase_preview"));
      setPhase("confirm");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    } finally {
      release();
    }
  };

  const erase = async () => {
    setError(null);
    setPhase("erasing");
    const release = beginDeviceOperation();
    try {
      const erased = await invoke<EraseResult>("hf_ndef_erase");
      setResult(erased);
      setPreview(null);
      // The erase is the operation the user confirmed, so it reports itself: the
      // words come from `eraseNotice` and the severity from the outcome's kind,
      // so the notice on the page and the sound cannot disagree.
      report(outcomes.erase(erased));
    } catch (e) {
      setError(String(e));
      // A Reader that could not send the erase is its own news, with its own
      // remedy — never an erase that did not happen.
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

  const confirmation = preview?.canErase ? eraseConfirmation(preview) : null;
  const notice = result ? eraseNotice(result) : null;

  return (
    <Section
      title="Erase a tag's content"
      hint="13.56 MHz only. Clears the NDEF message so the tag can be reused; the tag keeps its UID, its format and its capacity."
      actions={
        <Button
          variant="secondary"
          disabled={!connected || busy}
          onClick={() => void check()}
        >
          <ScanLine size={13} /> {phase === "reading" ? "Reading tag…" : "Check tag"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {!connected && (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Connect the Reader to erase a tag's content.
          </p>
        )}

        {error && (
          <Notice tone="err" label="Failed">
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">{error}</p>
          </Notice>
        )}

        {preview && !preview.canErase && (
          <Notice tone="warn" label="Not erased" onDismiss={cancel}>
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              {preview.refusal ?? "an erase would be refused"}.
            </p>
            {preview.tag && (
              <p className="font-mono text-[11px] text-text-muted">
                tag {preview.tag.uid}
                {preview.tag.existing.state === "empty"
                  ? " · reads back with no Records"
                  : preview.tag.existing.state === "message"
                    ? ` · reads back ${preview.tag.existing.bytes} content bytes`
                    : " · content unreadable"}
              </p>
            )}
          </Notice>
        )}

        {preview && confirmation && (
          <Notice tone="warn" label="Check this" title={confirmation.title}>
            <p className="max-w-prose text-sm leading-relaxed text-text">
              {confirmation.sentence}
            </p>
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              {confirmation.where}
            </p>
            <ul className="flex flex-col gap-2">
              {confirmation.facts.map((fact) => (
                <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
                  <span className="text-text">{fact.title}.</span> {fact.detail}
                </li>
              ))}
            </ul>
            {/* The two limits, as one sentence each and one paragraph between them:
                a single destructive action does not need nine blocks of prose, and
                at 900×700 it needs its own buttons on screen (follow-up ticket
                "The Erase confirmation is taller than the window"). */}
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              {confirmation.notReadOnly} {confirmation.notPasswordRemoval}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" disabled={busy} onClick={() => void erase()}>
                <Eraser size={13} />{" "}
                {phase === "erasing" ? "Erasing…" : confirmation.action}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={cancel}>
                Keep the content
              </Button>
              <span className="text-[11px] leading-relaxed text-text-muted">
                Keep the tag on the Reader until the result appears.
              </span>
            </div>
          </Notice>
        )}

        {notice && result && (
          <Notice
            tone={notice.tone}
            label={
              result.outcome === "erased"
                ? "Erased"
                : notice.tone === "warn"
                  ? "Unconfirmed"
                  : "Not erased"
            }
          >
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              {notice.text}
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Field
                label="Reads back"
                value={result.after ? result.after.existing.state : "no read-back"}
                tone={result.after ? "default" : "muted"}
              />
              <Field
                label="Content"
                value={result.after ? recordCountLabel(result) : "unknown"}
                tone={result.after ? "default" : "muted"}
              />
              <Field
                label="Capacity"
                value={
                  result.after?.capacityBytes != null
                    ? `${result.after.capacityBytes} bytes`
                    : "unknown"
                }
                tone={result.after?.capacityBytes != null ? "default" : "muted"}
              />
              <Field
                label="Pages written"
                value={erasedPagesLabel(result)}
                tone={result.acceptedPages.length > 0 ? "default" : "muted"}
              />
            </div>
            {result.before && (
              <Readout value={result.before.uid} />
            )}
            {result.writtenHex !== "" && (
              <code className="block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-[11px] leading-relaxed text-accent-muted">
                {result.writtenHex}
              </code>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={!connected || busy} onClick={() => void check()}>
                <ScanLine size={13} /> Check the tag again
              </Button>
              <Button variant="ghost" disabled={busy} onClick={cancel}>
                Done
              </Button>
            </div>
          </Notice>
        )}

        {!preview && !notice && !error && (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Check the tag first: the Reader reads it and reports the Records an erase would
            clear, and which pages it would write. Nothing is erased until you confirm.
          </p>
        )}
      </div>
    </Section>
  );
}

/** "no Records" / "1 Record", from what the tag read back as. */
function recordCountLabel(result: EraseResult): string {
  const bytes = result.after?.existing.bytes ?? 0;
  if (bytes === 0) return "no Records";
  return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
}
