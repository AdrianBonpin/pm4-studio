import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, ArrowRight, Check, Layers, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";
import { BatchClone } from "./BatchClone";
import { Field, Readout } from "./Section";
import {
  ReplacementConfirmation,
  replacementActionVariant,
} from "./ReplacementConfirmation";
import { useLfPoller } from "../hooks/useReader";
import { outcomes, report, type Outcome, type OutcomeKind } from "../lib/outcome";
import { replacementConfirmation } from "../lib/replacement";
import { confirmedCopiesLabel } from "../lib/writeOutcome";
import type { LfCard, WriteResult } from "../types";

type Step =
  | "idle"
  | "awaitSource"
  | "sourceReady"
  | "awaitDest"
  /** The Blank was read; the write waits on a confirmation naming what it holds. */
  | "confirmDest"
  | "writing"
  /** The write came to something, and the flow says which. */
  | "result"
  | "batch";

const STEP_ORDER: Step[] = [
  "awaitSource",
  "sourceReady",
  "awaitDest",
  "confirmDest",
  "writing",
];

function stepIndex(step: Step): number {
  const i = STEP_ORDER.indexOf(step);
  return i < 0 ? STEP_ORDER.length : i;
}

const LABELS = ["Tap source", "Read source", "Tap blank", "Confirm", "Writing"];

interface CloneWizardProps {
  connected: boolean;
  onSaved?: (card: LfCard) => void;
  /**
   * Accepted and unused: the shell's legacy chirp callback. Every sound this
   * flow makes now comes from the outcome seam, and the prop is deleted with the
   * rest of them in ticket 17.
   */
  onChirp?: () => void;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

/**
 * Guided clone: tap the original, confirm what was read, swap in a blank, write,
 * verify. One linear flow with the current step always visible.
 *
 * # Every step reports itself
 *
 * The two taps are the parts a user waits through, so each read is its own
 * outcome: the original read and the reading of the Tag in the write position are
 * reported separately, with their own message and their own signal. Nothing is
 * reported while the Reader is merely being polled — the iterations are
 * background work, and the reading that completes a step is the operation.
 *
 * The write is reported as whatever it actually came to, through the same seam,
 * and the flow's end state is derived from that outcome's discriminator rather
 * than from a boolean:
 *
 *   - `verified` — done, and the read-back is on screen as the evidence;
 *   - `unverified` — needs you: the write was sent and the read-back could not
 *     confirm it, which is neither success nor failure, and is never shown as a
 *     failure;
 *   - `skipped` / `unreadable` — the guard refused, and the two conditions are
 *     named apart because they have two different fixes: a Tag that already
 *     carries this Identity is the wrong Tag, while nothing readable is a Tag
 *     that is not there;
 *   - `failed` — the write could not be sent at all.
 *
 * The blank is read before it is written, and that reading is what the
 * confirmation names: a Tag that carries another Identity is not a Blank, and the
 * write destroys what it carries. The wording comes from `lib/replacement.ts`,
 * the same module authoring an Identity uses, and the markup from
 * `ReplacementConfirmation`, which both paths render — so the two confirmations
 * cannot disagree about what a destructive write says, or about how serious it
 * looks.
 *
 * The same source reading also feeds a Batch Clone (`batch` step): one Identity
 * written to successive Blanks, each attempt reporting its own result. Sharing
 * the read here is the point — the original is tapped once either way, and the
 * batch path must never re-read it per attempt.
 */
export function CloneWizard({ connected, onSaved, onDeviceError }: CloneWizardProps) {
  const [step, setStep] = useState<Step>("idle");
  const [source, setSource] = useState<LfCard | null>(null);
  const [dest, setDest] = useState<LfCard | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResult | null>(null);
  /** What the write came to, exactly as it was reported. */
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /**
   * The Identity the wizard has already reported as still being the original, so
   * the same reading is named once rather than once per poll.
   */
  const reportedInPlace = useRef<string | null>(null);

  const polling = step === "awaitSource" || step === "awaitDest";

  const reset = useCallback(() => {
    setStep("idle");
    setSource(null);
    setDest(null);
    setNote(null);
    setResult(null);
    setOutcome(null);
    reportedInPlace.current = null;
  }, []);

  const doWrite = useCallback(async (src: LfCard) => {
    setStep("writing");
    try {
      const res = await invoke<WriteResult>("lf_write", {
        customer: src.customer,
        data32: src.data32,
      });
      // One outcome, built from the result and reported through the seam, then
      // used as-is to render the end state: the words on screen and the sound
      // that was made cannot disagree because they are the same value.
      const written = outcomes.write("clone", res);
      setResult(res);
      setOutcome(written);
      report(written);
    } catch (e) {
      // A wedged, absent or claimed Reader is reported with its remedy, and
      // never as a write that happened.
      const failed = outcomes.readerFailure(e);
      setResult(null);
      setOutcome(failed);
      report(failed);
    } finally {
      setStep("result");
    }
  }, []);

  useLfPoller(
    polling,
    connected,
    (card) => {
      if (step === "awaitSource") {
        setSource(card);
        setNote(null);
        setStep("sourceReady");
        report(outcomes.cloneSourceRead(card.id));
        return;
      }
      if (step === "awaitDest" && source) {
        if (card.id === source.id) {
          // The original is still on the Reader, which is exactly the condition
          // the guard refuses a write on. Naming it at the read costs nothing and
          // saves the round trip; naming it once, however long the Tag stays
          // there, keeps the signal meaningful.
          setNote("That is still the original tag. Take it off and tap a blank tag.");
          if (reportedInPlace.current !== card.id) {
            reportedInPlace.current = card.id;
            report(outcomes.cloneSourceStillInPlace(card.id));
          }
          // Keep listening: the user is about to swap the Tag, and a stopped
          // poller could never see it.
          return "keep-listening";
        }
        // Read, then ask. `write_guard::decide` allows writing over a Tag that
        // carries a different Identity, so this reading is the only chance to say
        // which Identity is about to be lost.
        reportedInPlace.current = null;
        setDest(card);
        setNote(null);
        setStep("confirmDest");
        report(outcomes.cloneDestinationRead(card.id));
      }
    },
    onDeviceError,
  );

  // Clear a stale "still the original tag" note once the flow moves on.
  useEffect(() => {
    if (step !== "awaitDest") setNote(null);
  }, [step]);

  if (step === "idle") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-text-muted">
          Copies a tag's identity onto a blank tag. You will tap the original first, then a
          blank, and the result is read back to prove it matches.
        </p>
        <div>
          <Button variant="primary" disabled={!connected} onClick={() => setStep("awaitSource")}>
            Start clone
          </Button>
        </div>
      </div>
    );
  }

  // The batch is its own run: it holds the reader and reports attempt by attempt,
  // so it takes over the whole step rather than sitting inside the stepper.
  if (step === "batch" && source) {
    return (
      <BatchClone
        source={source}
        connected={connected}
        onExit={() => setStep("sourceReady")}
      />
    );
  }

  const current = stepIndex(step);

  // Built from the reading taken in the step before, never from what the flow
  // assumed was on the reader: the Tag that was read is the Tag the button names.
  const cloneConfirmation =
    step === "confirmDest" && source && dest
      ? replacementConfirmation(source, { kind: "identified", card: dest })
      : null;

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.12em]">
        {LABELS.map((label, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={
                  state === "active"
                    ? "text-text"
                    : state === "done"
                      ? "text-ok"
                      : "text-text-muted/60"
                }
              >
                {state === "done" ? <Check size={11} className="inline" /> : null} {label}
              </span>
              {i < LABELS.length - 1 && <ArrowRight size={11} className="text-text-muted/40" />}
            </li>
          );
        })}
      </ol>

      {step === "awaitSource" && (
        <p className="text-sm text-text-muted">
          Tap the tag you want to copy on the reader, flat and centred.
        </p>
      )}

      {step === "sourceReady" && source && (
        <div className="flex flex-col gap-4">
          <Readout value={source.id} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Facility / card" value={`${source.facility} / ${source.card}`} />
            <Field label="data32" value={`0x${source.data32.toString(16).padStart(8, "0").toUpperCase()}`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setStep("awaitDest")}>
              Use this tag
            </Button>
            <Button variant="secondary" onClick={() => setStep("batch")}>
              <Layers size={13} /> Write it to several blanks
            </Button>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === "awaitDest" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Take the original <span className="font-mono text-text">{source?.id}</span> off the
            reader, then tap a <strong className="text-text">blank</strong> tag on it.
          </p>
          {note && <p className="text-xs text-warn">{note}</p>}
          <div>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {cloneConfirmation && source && dest && (
        <div className="flex flex-col gap-4">
          <ReplacementConfirmation confirmation={cloneConfirmation} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={replacementActionVariant(cloneConfirmation.destructive)}
              onClick={() => void doWrite(source)}
            >
              {cloneConfirmation.action}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDest(null);
                setStep("awaitDest");
              }}
            >
              Tap a different tag
            </Button>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === "writing" && (
        <p className="text-sm text-text-muted">
          Writing <span className="font-mono text-text">{source?.id}</span> to{" "}
          <span className="font-mono text-text">{dest?.id}</span>…
        </p>
      )}

      {step === "result" && outcome && (
        <CloneResult
          outcome={outcome}
          result={outcome.kind === "verified" ? result : null}
          dest={dest}
          source={source}
          onReset={reset}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

/**
 * What the confirmation and the write came to, in the words of the outcome.
 *
 * The `verified` case shows the evidence — the Identity the Tag reads back as,
 * and how many copies the library now lists — because that is the thing worth
 * looking at. Every other case shows the state the flow is in and what to do
 * about it, keyed on the outcome's discriminator: the two refusal conditions
 * cannot be rendered alike because their titles, their advice and their icons are
 * chosen here from two different values.
 */
function CloneResult({
  outcome,
  result,
  dest,
  source,
  onReset,
  onSaved,
}: {
  outcome: Outcome;
  result: WriteResult | null;
  dest: LfCard | null;
  source: LfCard | null;
  onReset: () => void;
  onSaved?: (card: LfCard) => void;
}) {
  if (outcome.kind === "verified") {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-ok">
          <Check size={15} /> Cloned and verified
        </p>
        <Readout value={result?.readback?.id ?? source?.id} />
        {result && result.confirmedCopies !== null && (
          <p className="text-xs text-text-muted">
            {confirmedCopiesLabel(result.confirmedCopies)} in the library.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Facility / card"
            value={
              result?.readback
                ? `${result.readback.facility} / ${result.readback.card}`
                : "—"
            }
          />
          <Field label="Written from" value={dest ? dest.id : "—"} tone="muted" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onReset}>
            <RotateCcw size={13} /> Clone another
          </Button>
          {source && onSaved && (
            <Button variant="secondary" onClick={() => onSaved(source)}>
              Save to library
            </Button>
          )}
        </div>
      </div>
    );
  }

  const copy =
    RESULT_COPY[outcome.kind] ?? {
      // A failure the guard did not cause — a dead, absent or claimed Reader —
      // keeps its own words, because rewriting it as a write that was refused
      // would name a condition nobody established.
      title: outcome.message,
      advice: outcome.detail ?? null,
      tone: "err" as const,
    };

  return (
    <div className="flex flex-col gap-3">
      <p className={`flex items-start gap-2 text-sm ${RESULT_TONE_CLASS[copy.tone]}`}>
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <span className="select-text">{copy.title}</span>
      </p>
      {copy.advice && (
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">{copy.advice}</p>
      )}
      <div>
        <Button variant="secondary" onClick={onReset}>
          <RotateCcw size={13} /> Start over
        </Button>
      </div>
    </div>
  );
}

type ResultTone = "warn" | "err";

/**
 * The state a write left the flow in, and what to do about it.
 *
 * The advice is deliberately about the next action rather than a second copy of
 * the reported message: the message is the outcome's own (the guard's words), and
 * it has already been said.
 */
const RESULT_COPY: Partial<
  Record<OutcomeKind, { title: string; advice: string | null; tone: ResultTone }>
> = {
  unverified: {
    title: "Unknown — the tag did not read back",
    advice:
      "The write was sent, so the tag may or may not carry this identity. Read the tag on the " +
      "reader to find out what it holds. Nothing was counted as a copy.",
    tone: "warn",
  },
  skipped: {
    title: "Skipped — the tag already carries this identity",
    advice:
      "Nothing was written and nothing was counted. Take the tag off the reader and put a " +
      "different one on — a tag that already presents this identity is never written again.",
    tone: "warn",
  },
  unreadable: {
    title: "Not written — nothing readable on the reader",
    advice:
      "The write was refused rather than sent blind, so the tag in the write position was not " +
      "touched. Seat a 125 kHz tag that reads, then start the clone again.",
    tone: "err",
  },
  refused: {
    title: "Not written — the guard refused the write",
    advice: "Nothing was written. Check the tag on the reader and start the clone again.",
    tone: "err",
  },
  failed: {
    title: "Not written — the write could not be sent",
    advice: "The tag was not written. Check the Reader is still connected and try again.",
    tone: "err",
  },
};

const RESULT_TONE_CLASS: Record<ResultTone, string> = {
  warn: "text-warn",
  err: "text-err",
};
