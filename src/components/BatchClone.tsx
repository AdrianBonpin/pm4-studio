import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Layers, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";
import { Notice } from "./ui/Notice";
import { Field, Readout } from "./Section";
import { beginDeviceOperation } from "../lib/deviceLock";
import { outcomes, report } from "../lib/outcome";
import {
  BATCH_FACTS,
  FRESH_TAG_PER_ATTEMPT,
  OUTCOME_LABEL,
  OUTCOME_TONE_CLASS,
  attemptRequest,
  recordAttempt,
  runConfirmedCopies,
  sourceIdentity,
  startBatch,
  summarySentence,
  type BatchRun,
} from "../lib/batchClone";
import { confirmedCopiesLabel } from "../lib/writeOutcome";
import type { BatchAttemptResult, LfCard } from "../types";

interface BatchCloneProps {
  /** The reading taken once in the wizard. Never re-read while the run is open. */
  source: LfCard;
  connected: boolean;
  /** Back to the wizard, keeping the source reading. */
  onExit: () => void;
}

/**
 * Write one held Identity to successive Blanks.
 *
 * The original is read once, before this component mounts: every attempt writes
 * that same Identity and never taps the source again. That is the several-people
 * case — one read, then one Blank per recipient.
 *
 * # Every attempt reports itself, through the seam
 *
 * Each attempt is sent on its own and ends in exactly one outcome, reported the
 * moment it arrives — the worked fob and the one that was not written are heard
 * without reading the list, which is what makes a run of twenty usable without
 * looking at it. The four things an attempt can be stay apart:
 *
 *   - `verified` — done: the read-back proved the copy, and only this adds a
 *     confirmed copy to the run's count;
 *   - `unverified` — needs you: sent, and the read-back could not confirm it;
 *   - `skipped` — attention: the Tag already carries this Identity, so the guard
 *     refused and nothing was written or counted. A refusal is three chirps
 *     (spec's alphabet table); what the skip means is in the ledger's words, not
 *     in a softer sound;
 *   - `unreadable` / `failed` — attention: nothing could be read, or the write
 *     could not be sent.
 *
 * A refusal or a skip does not end the run: the list keeps every attempt, in
 * order, with its own result. An attempt the Reader failed outright is recorded
 * as a failed attempt rather than dropped, so the ledger holds every press and
 * the count still only rises for a verified write.
 *
 * Polling reports nothing here, and the Reader is held for the whole run
 * (`beginDeviceOperation`), so no background iteration can be mistaken for an
 * attempt or raise a signal of its own. Suspending polling is not a nicety: a
 * poll reply read as part of an attempt's exchange has already been mistaken for
 * a write result once.
 */
export function BatchClone({ source, connected, onExit }: BatchCloneProps) {
  const [run, setRun] = useState<BatchRun>(() => startBatch(source));
  const [busy, setBusy] = useState(false);

  // One hold for the run, released when the user leaves it. Pollers check
  // `isDeviceBusy()` before each tick, so nothing polls while a batch is open.
  useEffect(() => {
    const release = beginDeviceOperation();
    return release;
  }, []);

  const writeNext = useCallback(async () => {
    setBusy(true);
    try {
      // The Identity comes from the held source reading, never from anything
      // read mid-run.
      const result = await invoke<BatchAttemptResult>(
        "lf_clone_attempt",
        attemptRequest(run),
      );
      setRun((current) => recordAttempt(current, result));
      report(outcomes.batchAttempt(result));
    } catch (e) {
      // A wedged or absent Reader is a failed attempt, not a silent one: it is
      // recorded and heard like any other, with the remedy the classification
      // carries, and it never adds a copy.
      const failure = outcomes.readerFailure(e);
      const failed: BatchAttemptResult = {
        customer: source.customer,
        data32: source.data32,
        outcome: "failed",
        message: failure.message,
        refusalCause: null,
        readback: null,
        confirmedCopies: null,
        countProblem: null,
      };
      setRun((current) => recordAttempt(current, failed));
      report(failure);
    } finally {
      setBusy(false);
    }
  }, [source.customer, source.data32, run]);

  const copies = runConfirmedCopies(run);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Readout value={sourceIdentity(run)} />
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label="Facility / card" value={`${source.facility} / ${source.card}`} />
          <Field label="data32" value={`0x${source.data32.toString(16).padStart(8, "0").toUpperCase()}`} />
        </div>
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          This identity was read once. Every attempt below writes it, so the original tag does
          not have to be tapped again.
        </p>
      </div>

      <Notice tone="warn" label="Check this" title="One tag per attempt">
        <ul className="flex flex-col gap-2">
          {BATCH_FACTS.map((fact) => (
            <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
              <span className="text-text">{fact.title}.</span> {fact.detail}
            </li>
          ))}
        </ul>
      </Notice>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!connected || busy} onClick={() => void writeNext()}>
          <Layers size={13} /> {busy ? "Writing…" : "Write the blank on the reader"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onExit}>
          <RotateCcw size={13} /> Finish batch
        </Button>
        {copies > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-ok">
            <Check size={12} /> {confirmedCopiesLabel(copies)} made by this run
          </span>
        )}
      </div>

      <p className="max-w-prose text-xs leading-relaxed text-text-muted">{FRESH_TAG_PER_ATTEMPT}</p>

      <p className="max-w-prose text-xs text-text-muted">
        Polls are paused for the length of this run, so the reader answers attempts and nothing
        else.
      </p>

      <div className="flex flex-col gap-3">
        <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Attempts</p>
        <p className="text-sm text-text-muted">{summarySentence(run)}</p>
        {run.attempts.length > 0 && (
          <ol className="flex flex-col gap-2">
            {run.attempts.map((attempt, index) => (
              <li
                // Attempts are append-only and positional, so the index is the
                // attempt's own number and a stable key.
                key={index}
                className="flex flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <span className="flex flex-wrap items-baseline gap-2 font-mono text-xs">
                  <span className="text-text-muted">{String(index + 1).padStart(2, "0")}</span>
                  <span className={OUTCOME_TONE_CLASS[attempt.outcome]}>
                    {OUTCOME_LABEL[attempt.outcome]}
                  </span>
                  {attempt.readback && (
                    <span className="text-text-muted">{attempt.readback.id}</span>
                  )}
                  {attempt.countProblem && (
                    <span className="text-warn">{attempt.countProblem}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
