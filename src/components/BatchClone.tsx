import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Layers, RotateCcw } from "lucide-react";
import { Button } from "./ui/Button";
import { Field, Readout } from "./Section";
import { beginDeviceOperation } from "../lib/deviceLock";
import { describeDeviceFailure } from "../lib/readerIdentity";
import {
  BATCH_FACTS,
  FRESH_TAG_PER_ATTEMPT,
  OUTCOME_LABEL,
  OUTCOME_TONE_CLASS,
  attemptNotice,
  attemptRequest,
  recordAttempt,
  runConfirmedCopies,
  sourceIdentity,
  startBatch,
  summarySentence,
  type BatchRun,
} from "../lib/batchClone";
import { NOTICE_TONE_CLASS, confirmedCopiesLabel } from "../lib/writeOutcome";
import type { BatchAttemptResult, LfCard } from "../types";

interface BatchCloneProps {
  /** The reading taken once in the wizard. Never re-read while the run is open. */
  source: LfCard;
  connected: boolean;
  onChirp: () => void;
  /** Back to the wizard, keeping the source reading. */
  onExit: () => void;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

/**
 * Write one held Identity to successive Blanks.
 *
 * The original is read once, before this component mounts: every attempt writes
 * that same Identity and never taps the source again. That is the several-people
 * case — one read, then one Blank per recipient.
 *
 * Each attempt is sent on its own and reports its own result. A refusal does not
 * end the run; the list keeps every attempt, in order, with its own outcome. Only
 * a verified attempt adds a confirmed copy, so leaving a Tag on the Reader and
 * pressing the button again reports a **skip** instead of counting a second copy:
 * the backend re-reads the Tag in the write position for every attempt, per ADR
 * 0001, and a Tag that already presents this Identity is not written again.
 *
 * The Reader is held for the whole run (`beginDeviceOperation`), so background
 * polling cannot put a question to it between attempts. Suspending polling is not
 * a nicety: a poll reply read as part of an attempt's exchange has already been
 * mistaken for a write result once.
 */
export function BatchClone({ source, connected, onChirp, onExit, onDeviceError }: BatchCloneProps) {
  const [run, setRun] = useState<BatchRun>(() => startBatch(source));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One hold for the run, released when the user leaves it. Pollers check
  // `isDeviceBusy()` before each tick, so nothing polls while a batch is open.
  useEffect(() => {
    const release = beginDeviceOperation();
    return release;
  }, []);

  const writeNext = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // The Identity comes from the held source reading, never from anything
      // read mid-run.
      const result = await invoke<BatchAttemptResult>(
        "lf_clone_attempt",
        attemptRequest(run),
      );
      setRun((current) => recordAttempt(current, result));
      if (result.outcome === "verified") onChirp();
    } catch (e) {
      // A wedged or absent Reader is reported with its remedy, not as a bare
      // timeout, and it is not recorded as an attempt: nothing was decided.
      const message = describeDeviceFailure(e);
      setError(message);
      onDeviceError?.(message);
    } finally {
      setBusy(false);
    }
  }, [onChirp, onDeviceError, run]);

  const latest = run.attempts[run.attempts.length - 1];
  const notice = latest ? attemptNotice(latest) : null;
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

      <div className="border-l-2 border-warn bg-warn/5 px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm text-warn">
          <AlertTriangle size={14} /> One tag per attempt
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {BATCH_FACTS.map((fact) => (
            <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
              <span className="text-text">{fact.title}.</span> {fact.detail}
            </li>
          ))}
        </ul>
      </div>

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

      <p className="text-xs text-text-muted">
        Polls are paused for the length of this run, so the reader answers attempts and nothing
        else.
      </p>

      {error && <p className="text-sm text-err">{error}</p>}

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
