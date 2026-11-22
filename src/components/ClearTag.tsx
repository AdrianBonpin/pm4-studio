import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Ban, Check, RotateCcw, ScanLine, ShieldAlert } from "lucide-react";
import { Button } from "./ui/Button";
import { Notice } from "./ui/Notice";
import { Field, Readout, Section } from "./Section";
import { useLfPoller } from "../hooks/useReader";
import { describeDeviceFailure } from "../lib/readerIdentity";
import {
  CLEAR_ANOTHER_CONTROL,
  CLEAR_PANEL_HINT,
  CLEAR_PANEL_TITLE,
  CLEAR_READ_CONTROL,
  DESTROY_ANOTHER_CONTROL,
  DESTROY_ENTER_CONTROL,
  DESTROY_PANEL_HINT,
  DESTROY_PANEL_TITLE,
  reReadNotice,
  tagConfirmation,
  tagOperationNotice,
} from "../lib/clearTag";
import { outcomes, report } from "../lib/outcome";
import { NOTICE_TONE_CLASS } from "../lib/noticeTone";
import type { WriteNotice } from "../lib/writeOutcome";
import type { ClearResult, LfCard, TagOperation } from "../types";

type Step = "idle" | "await" | "confirm" | "writing" | "done";

interface ClearTagProps {
  connected: boolean;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

/**
 * Clear a Tag's Identity — or, behind its own gate, destroy it.
 *
 * Two operations on one panel, and the difference is the whole design:
 *
 *   * **Clear** is the panel's primary action and the mode's name. It reads the
 *     Tag, asks once, and writes the non-zero placeholder. The Tag stops being a
 *     working credential and stays a live, rewritable chip.
 *   * **Destroy** is a separate entry point on the panel's first screen, with its
 *     own read, its own confirmation and its own danger button. It is never the
 *     default, and no repetition of Clear can reach it: the everyday action's
 *     "another tag" control returns to the first screen, not to Destroy.
 *
 * Both flows are two deliberate steps — read the Tag, then confirm overwriting the
 * Identity that was read. The confirmation names that Identity and is passed back
 * into the write, so the Rust guard can refuse if the Tag on the Reader is a
 * different one. A confirmation cannot be carried across to another Tag.
 *
 * The component decides neither the wording nor the classification. Rust judges the
 * re-read and returns one outcome for the operation the user chose; `lib/clearTag`
 * words it, `lib/severity` gives it its severity, and `lib/outcome` reports it, so
 * the message and the signal cannot disagree — and a Clear can never be reported in
 * a Destroy's words or the other way round.
 *
 * The mode is called **Clear** in `lib/lfModes`, and this panel's heading says the
 * same word. "Reset" is retired from this operation entirely: it named a factory
 * restore the hardware cannot perform, and it was the name under which the
 * destructive write consumed three tags.
 */
export function ClearTag({ connected, onDeviceError }: ClearTagProps) {
  const [step, setStep] = useState<Step>("idle");
  /** The operation the current flow is for. Clear until the user says otherwise. */
  const [operation, setOperation] = useState<TagOperation>("clear");
  const [card, setCard] = useState<LfCard | null>(null);
  const [result, setResult] = useState<ClearResult | null>(null);
  const [notice, setNotice] = useState<WriteNotice | null>(null);
  /** What a deliberate re-read after the write showed. */
  const [check, setCheck] = useState<WriteNotice | null>(null);
  const [busy, setBusy] = useState(false);

  const restart = useCallback(() => {
    setStep("idle");
    setCard(null);
    setResult(null);
    setNotice(null);
    setCheck(null);
    // Back to the safe default, so a Destroy flow cannot leak into the next one.
    setOperation("clear");
  }, []);

  /** Enter one of the two flows from the panel's first screen. */
  const begin = useCallback((next: TagOperation) => {
    setOperation(next);
    setStep("await");
  }, []);

  useLfPoller(
    step === "await",
    connected,
    (read) => {
      setCard(read);
      setStep("confirm");
      // The Tag the user asked to overwrite was read: that reading is an operation
      // of its own and reports itself, the same way a Clone's two reads do. The
      // write that may follow reports separately, so no step of this flow is
      // silent and none of them is heard twice.
      report(outcomes.tagRead("clear", read.id));
    },
    onDeviceError,
  );

  const overwrite = useCallback(
    async (confirmed: LfCard, action: TagOperation) => {
      setStep("writing");
      setBusy(true);
      setCheck(null);
      try {
        const res = await invoke<ClearResult>("lf_clear", {
          customer: confirmed.customer,
          data32: confirmed.data32,
          operation: action,
        });
        setResult(res);
        // One outcome for the whole attempt: the message and the sound both come
        // from the classification Rust returned, for the operation that was asked
        // for. A mismatch is reported as a refusal rather than as either success.
        setNotice(tagOperationNotice(action, res));
        report(outcomes.clear(action, res));
      } catch (e) {
        // A wedged or absent Reader is reported with its remedy, not a bare
        // timeout, and never as a completed clear or destroy.
        setNotice({ tone: "err", text: describeDeviceFailure(e) });
        report(outcomes.readerFailure(e));
      } finally {
        setBusy(false);
        setStep("done");
      }
    },
    [],
  );

  const checkTag = useCallback(async () => {
    setBusy(true);
    try {
      const read = await invoke<LfCard | null>("lf_poll");
      // Compared against what the write actually reported, so a clear that did not
      // land is not mistaken for a tag that merely left the reader.
      setCheck(reReadNotice(operation, result?.presents ?? null, read));
    } catch (e) {
      setCheck({ tone: "err", text: describeDeviceFailure(e) });
    } finally {
      setBusy(false);
    }
  }, [operation, result]);

  const confirmation = card ? tagConfirmation(operation, card.id) : null;
  const destroying = operation === "destroy";

  return (
    <Section title={CLEAR_PANEL_TITLE} hint={CLEAR_PANEL_HINT}>
      {step === "idle" && (
        <div className="flex flex-col gap-4">
          {/* What Clear is, in Clear's own name. What it cannot do — write a factory
              configuration back, or unlock a tag — is one of this Reader's limits and
              is stated once, in Settings → Diagnostics → Capability limits, rather
              than denied again here. */}
          <p className="max-w-prose text-sm leading-relaxed text-text-muted">
            Clear writes a placeholder Identity over the tag on the reader. The tag keeps
            working as a tag — it still reads, and it can be written again from this app — but
            it carries a value no building system issues, so it will not open anything.
          </p>
          <div>
            <Button variant="primary" disabled={!connected} onClick={() => begin("clear")}>
              <ScanLine size={13} /> {CLEAR_READ_CONTROL}
            </Button>
          </div>

          {/* Destroy is its own entry point, not a second button on Clear's
              confirmation. A user clearing tags all day cannot arrive here by
              repeating the everyday action, and what it does is stated where it is
              offered rather than discovered afterwards. */}
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm font-medium text-text">{DESTROY_PANEL_TITLE}</p>
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              {DESTROY_PANEL_HINT}
            </p>
            <div>
              <Button variant="ghost" disabled={!connected} onClick={() => begin("destroy")}>
                <ShieldAlert size={13} /> {DESTROY_ENTER_CONTROL}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "await" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Tap the tag you want to {operation} on the reader, flat and centred.
          </p>
          <div>
            <Button variant="ghost" onClick={restart}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === "confirm" && card && confirmation && (
        <div className="flex flex-col gap-4">
          <Readout value={card.id} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Facility / card" value={`${card.facility} / ${card.card}`} />
            <Field
              label="data32"
              value={`0x${card.data32.toString(16).padStart(8, "0").toUpperCase()}`}
            />
          </div>

          <Notice
            tone={destroying ? "err" : "warn"}
            label={destroying ? "This cannot be undone" : "Check this"}
            title={confirmation.title}
          >
            <ul className="flex flex-col gap-2">
              {confirmation.facts.map((fact) => (
                <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
                  <span className="text-text">{fact.title}.</span> {fact.detail}
                </li>
              ))}
            </ul>
          </Notice>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={destroying ? "danger" : "primary"}
              onClick={() => void overwrite(card, operation)}
            >
              <Ban size={13} /> {confirmation.action}
            </Button>
            <Button variant="ghost" autoFocus onClick={restart}>
              Keep the tag as it is
            </Button>
          </div>
        </div>
      )}

      {step === "writing" && (
        <p className="text-sm text-text-muted">
          {destroying ? "Destroying" : "Clearing"}{" "}
          <span className="font-mono text-text">{card?.id}</span>…
        </p>
      )}

      {step === "done" && (
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

          {result?.cleared && result.presents && (
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              Now carried by the tag:{" "}
              <span className="font-mono text-text">{result.presents}</span> — the placeholder
              this app writes. It is not a working credential, and a tag holding it is a fair
              place to write a real Identity.
            </p>
          )}

          {result?.presents && !result.cleared && (
            <p className="text-xs text-text-muted">
              Still on the tag:{" "}
              <span className="font-mono text-text">{result.presents}</span>
            </p>
          )}

          {check && (
            <p className={`flex items-start gap-1.5 text-xs ${NOTICE_TONE_CLASS[check.tone]}`}>
              <span className="select-text">{check.text}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={!connected || busy} onClick={() => void checkTag()}>
              <ScanLine size={13} /> Read the tag now
            </Button>
            <Button variant="ghost" disabled={busy} onClick={restart}>
              <RotateCcw size={13} />{" "}
              {destroying ? DESTROY_ANOTHER_CONTROL : CLEAR_ANOTHER_CONTROL}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
