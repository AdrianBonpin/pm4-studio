import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Ban, Check, RotateCcw, ScanLine } from "lucide-react";
import { Button } from "./ui/Button";
import { Notice } from "./ui/Notice";
import { Field, Readout, Section } from "./Section";
import { useLfPoller } from "../hooks/useReader";
import { describeDeviceFailure } from "../lib/readerIdentity";
import {
  RESET_ANOTHER_CONTROL,
  RESET_OUTCOME_HINT,
  RESET_PANEL_HINT,
  RESET_PANEL_TITLE,
  RESET_READ_CONTROL,
  resetCheckNotice,
  resetConfirmation,
  resetNotice,
} from "../lib/blankTag";
import { outcomes, report } from "../lib/outcome";
import { NOTICE_TONE_CLASS } from "../lib/noticeTone";
import type { WriteNotice } from "../lib/writeOutcome";
import type { BlankResult, LfCard } from "../types";

type Step = "idle" | "await" | "confirm" | "writing" | "done";

interface BlankTagProps {
  connected: boolean;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

/**
 * Reset a Tag's Identity.
 *
 * Two deliberate steps: read the Tag, then confirm destroying the Identity that
 * was read. The confirmation names that Identity and is passed back into the
 * write, so the Rust guard can refuse if the Tag on the Reader is a different
 * one. A confirmation cannot be carried across to another Tag.
 *
 * The wording is **Reset** throughout, because that is the name of the operation
 * in `lib/lfModes`, the mode pill and GLOSSARY.md. The word "blank" is not a verb
 * here: it is the noun for a Tag that carries no Identity, and the panel does not
 * need a paragraph denying a factory restore, since that fact is one of the
 * Reader's capability limits and is stated there once. The wire value stays
 * `blanked` (see `lib/blankTag.ts`). The outcome is "blanked" and not "verified":
 * a Tag after a Reset reads as empty, and an empty reading is the expected result
 * rather than a failed check.
 *
 * The file and the component keep the name `BlankTag`, because they mirror the
 * Rust result they render (`BlankResult`, whose outcome is still `blanked`) and the
 * command they call (`lf_blank`). Interface copy says Reset; the wire vocabulary is
 * not interface copy.
 *
 * Reset is also the only writability test this Reader can offer, and the
 * confirmation says so before the write (ADR 0007). The component decides
 * neither the wording nor the classification: Rust judges the re-read, and every
 * step that completes reports its own outcome through the seam, with the message
 * and the signal both coming from there. So the reading that produces the
 * confirmation is reported as a read, and a re-read that still finds an Identity
 * reports "this tag will not accept writes" and sounds attention — while a
 * never-written Tag still blanks and is reported as blanked rather than as
 * verified.
 */
export function BlankTag({ connected, onDeviceError }: BlankTagProps) {
  const [step, setStep] = useState<Step>("idle");
  const [card, setCard] = useState<LfCard | null>(null);
  const [result, setResult] = useState<BlankResult | null>(null);
  const [notice, setNotice] = useState<WriteNotice | null>(null);
  /** What a deliberate re-read after the write showed. */
  const [check, setCheck] = useState<WriteNotice | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setStep("idle");
    setCard(null);
    setResult(null);
    setNotice(null);
    setCheck(null);
  }, []);

  useLfPoller(
    step === "await",
    connected,
    (read) => {
      setCard(read);
      setStep("confirm");
      // The Tag the user asked to blank was read: that reading is an operation
      // of its own and reports itself, the same way a Clone's two reads do. The
      // blanking write that may follow reports separately, so no step of this
      // flow is silent and none of them is heard twice.
      report(outcomes.tagRead("reset", read.id));
    },
    onDeviceError,
  );

  const resetTag = useCallback(
    async (confirmed: LfCard) => {
      setStep("writing");
      setBusy(true);
      setCheck(null);
      try {
        const res = await invoke<BlankResult>("lf_blank", {
          customer: confirmed.customer,
          data32: confirmed.data32,
        });
        setResult(res);
        setNotice(resetNotice(res));
        // One outcome for the whole attempt: the message and the sound both come
        // from the classification Rust returned, so a tag that read back its own
        // Identity reports "will not accept writes" and sounds the attention
        // signal (three chirps, LED held on) without this component deciding
        // either.
        report(outcomes.blank(res));
      } catch (e) {
        // A wedged or absent Reader is reported with its remedy, not a bare
        // timeout, and never as a blank.
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
      // A re-read that still finds an Identity is the same finding the write's own
      // read-back produces, so it is worded by the same module rather than here.
      setCheck(resetCheckNotice(read));
    } catch (e) {
      setCheck({ tone: "err", text: describeDeviceFailure(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmation = card ? resetConfirmation(card.id) : null;

  return (
    <Section title={RESET_PANEL_TITLE} hint={RESET_PANEL_HINT}>
      {step === "idle" && (
        <div className="flex flex-col gap-3">
          {/* What Reset is, in Reset's own name. What it cannot do — write a factory
              configuration back, or unlock a tag — is one of this Reader's limits and
              is stated once, in Settings → Diagnostics → Capability limits, rather
              than denied again here. */}
          <p className="max-w-prose text-sm leading-relaxed text-text-muted">
            Reset writes a neutral Identity over the tag on the reader. The tag keeps working
            as a tag; it simply carries no assigned value any more.
          </p>
          <div>
            <Button
              variant="secondary"
              disabled={!connected}
              onClick={() => setStep("await")}
            >
              <ScanLine size={13} /> {RESET_READ_CONTROL}
            </Button>
          </div>
        </div>
      )}

      {step === "await" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Tap the tag you want to reset on the reader, flat and centred.
          </p>
          <div>
            <Button variant="ghost" onClick={reset}>
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

          <Notice tone="warn" label="Check this" title={confirmation.title}>
            <ul className="flex flex-col gap-2">
              {confirmation.facts.map((fact) => (
                <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
                  <span className="text-text">{fact.title}.</span> {fact.detail}
                </li>
              ))}
            </ul>
          </Notice>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" onClick={() => void resetTag(card)}>
              <Ban size={13} /> {confirmation.action}
            </Button>
            <Button variant="ghost" autoFocus onClick={reset}>
              Keep the tag as it is
            </Button>
          </div>
        </div>
      )}

      {step === "writing" && (
        <p className="text-sm text-text-muted">
          Resetting <span className="font-mono text-text">{card?.id}</span>…
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

          {result?.blanked && (
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              {RESET_OUTCOME_HINT}
            </p>
          )}

          {result?.stillIdentifies && (
            <p className="text-xs text-text-muted">
              Still on the tag:{" "}
              <span className="font-mono text-text">{result.stillIdentifies}</span>
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
            <Button variant="ghost" disabled={busy} onClick={reset}>
              <RotateCcw size={13} /> {RESET_ANOTHER_CONTROL}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
