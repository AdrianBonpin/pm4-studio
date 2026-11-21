import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRight, Check, Layers, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";
import { BatchClone } from "./BatchClone";
import { Field, Readout } from "./Section";
import {
  ReplacementConfirmation,
  replacementActionVariant,
} from "./ReplacementConfirmation";
import { useLfPoller } from "../hooks/useReader";
import { describeDeviceFailure } from "../lib/readerIdentity";
import { replacementConfirmation } from "../lib/replacement";
import { confirmedCopiesLabel, writeNotice } from "../lib/writeOutcome";
import type { LfCard, WriteResult } from "../types";

type Step =
  | "idle"
  | "awaitSource"
  | "sourceReady"
  | "awaitDest"
  /** The Blank was read; the write waits on a confirmation naming what it holds. */
  | "confirmDest"
  | "writing"
  | "done"
  | "failed"
  /** Several Blanks from the one source reading. Rendered by `BatchClone`. */
  | "batch";

const STEP_ORDER: Step[] = [
  "awaitSource",
  "sourceReady",
  "awaitDest",
  "confirmDest",
  "writing",
  "done",
];

function stepIndex(step: Step): number {
  const i = STEP_ORDER.indexOf(step);
  return i < 0 ? 0 : i;
}

const LABELS = ["Tap source", "Read source", "Tap blank", "Confirm", "Writing", "Done"];

interface CloneWizardProps {
  connected: boolean;
  onSaved?: (card: LfCard) => void;
  onChirp: () => void;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

/**
 * Guided clone: tap the original, confirm what was read, swap in a blank, write,
 * verify. One linear flow with the current step always visible.
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
export function CloneWizard({ connected, onSaved, onChirp, onDeviceError }: CloneWizardProps) {
  const [step, setStep] = useState<Step>("idle");
  const [source, setSource] = useState<LfCard | null>(null);
  const [dest, setDest] = useState<LfCard | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const polling = step === "awaitSource" || step === "awaitDest";

  const reset = useCallback(() => {
    setStep("idle");
    setSource(null);
    setDest(null);
    setNote(null);
    setResult(null);
    setErr(null);
  }, []);

  const doWrite = useCallback(
    async (src: LfCard, dst: LfCard) => {
      setStep("writing");
      setErr(null);
      try {
        const res = await invoke<WriteResult>("lf_write", {
          customer: src.customer,
          data32: src.data32,
        });
        setResult(res);
        if (res.verified) {
          setStep("done");
          onChirp();
        } else {
          setStep("failed");
          // The notice names the actual outcome: refused, unknown, or not sent.
          setErr(writeNotice(res).text);
        }
      } catch (e) {
        setStep("failed");
        // A wedged firmware is reported with its remedy, not as a bare timeout.
        setErr(describeDeviceFailure(e));
        void dst;
      }
    },
    [onChirp],
  );

  useLfPoller(
    polling,
    connected,
    (card) => {
      if (step === "awaitSource") {
        setSource(card);
        setNote(null);
        setStep("sourceReady");
        onChirp();
        return;
      }
      if (step === "awaitDest" && source) {
        if (card.id === source.id) {
          setNote("That is still the original tag. Take it off and tap a blank tag.");
          return;
        }
        // Read, then ask. `write_guard::decide` allows writing over a Tag that
        // carries a different Identity, so this reading is the only chance to say
        // which Identity is about to be lost.
        setDest(card);
        setNote(null);
        setStep("confirmDest");
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
        onChirp={onChirp}
        onExit={() => setStep("sourceReady")}
        onDeviceError={onDeviceError}
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
              onClick={() => void doWrite(source, dest)}
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

      {step === "done" && (
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
            <Field
              label="Written from"
              value={dest ? dest.id : "—"}
              tone="muted"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={reset}>
              <RotateCcw size={13} /> Clone another
            </Button>
            {source && onSaved && (
              <Button variant="secondary" onClick={() => onSaved(source)}>
                Save to library
              </Button>
            )}
          </div>
        </div>
      )}

      {step === "failed" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-err">{err}</p>
          <p className="text-xs leading-relaxed text-text-muted">
            A locked tag refuses all writes while still reading normally. If this blank has
            been written before, try a fresh one.
          </p>
          <div>
            <Button variant="secondary" onClick={reset}>
              Start over
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
