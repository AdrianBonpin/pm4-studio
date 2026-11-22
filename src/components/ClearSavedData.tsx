import { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Notice } from "./ui/Notice";
import { Section } from "./Section";
import {
  CLEAR_GATE_WORD,
  CLEAR_TARGET_LABEL,
  clearAllSavedData,
  clearGateSatisfied,
  describeClearReport,
  type ClearNotice,
  type ClearReport,
} from "../lib/clearData";
import { outcomes, report } from "../lib/outcome";

/**
 * The one action in this app that deletes what it has saved.
 *
 * It exists because handing the machine on or starting over has to be possible,
 * and because the alternative — the user deleting files by hand after being told
 * where they are — is the same deletion with less care. The care is the whole
 * component:
 *
 *   - **The gate is a typed word, not a click.** A second click is dismissed
 *     without reading; typing `clear` is a decision. The button cannot be pressed
 *     until the word is exactly there.
 *   - **It names what it will remove** before it removes it, and reports exactly
 *     what it did afterwards. A target that was not there is not claimed.
 *   - **A refusal is not a partial success.** If any target cannot be removed the
 *     report says so and names the part, and the list that follows is what
 *     actually went — never a tidy summary that hides the half that survived.
 *   - **It is only ever pressed here.** Nothing on a save path, a read path or a
 *     problem banner calls it: a library file a save refuses to overwrite stays
 *     where it is, and "clear" stays a thing the user asked for rather than the
 *     app's response to its own failure.
 *
 * The copy states that last part, because a user who has just been told their
 * library cannot be read is exactly the person who needs to know the difference
 * between "this app will not touch it" and "this action deletes it".
 */
export function ClearSavedData({ onCleared }: { onCleared?: () => void | Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClearReport | null>(null);
  const gated = clearGateSatisfied(typed);

  const clear = async () => {
    if (!gated || busy) return;
    setBusy(true);
    try {
      const outcome = await clearAllSavedData();
      setResult(outcome);
      // The same words on both channels, from one report: the message and the
      // block below it cannot tell the user different things.
      report(outcomes.dataCleared(outcome));
      // The library may be gone (or partly gone), so the page reloads it rather
      // than showing a view of a file that no longer exists. The app is in its
      // first-run state without a restart.
      if (outcome.removed.length > 0) await onCleared?.();
      if (outcome.cleared) setTyped("");
    } finally {
      setBusy(false);
    }
  };

  const notice = result ? describeClearReport(result) : null;

  return (
    <Section
      title="Clear all saved data"
      hint="Hand the machine on, or start over. This removes everything below, and nothing else."
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1.5">
          <ClearTarget>
            The library file, and the temporary file a save may have left beside it
          </ClearTarget>
          <ClearTarget>
            The legacy saved-reads store — reads saved before the library file existed
          </ClearTarget>
          <ClearTarget>
            The quiet-level and message-corner preferences, which fall back to their defaults
          </ClearTarget>
        </ul>

        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          The app resolves every one of these itself, so nothing outside its own storage can be
          reached, and a symbolic link is refused rather than followed. It works even when the
          library file cannot be read — the one case where a save refuses and this action does not —
          but it is never a stand-in for a failed save.
        </p>

        <div className="flex flex-col gap-2 sm:max-w-md">
          {/* The input carries its own accessible name; this is the visible
              instruction, so it is a paragraph rather than a label pointing at
              nothing. The word is shown in mono and in lower case, exactly as it
              has to be typed: an uppercase instruction invites an uppercase
              attempt, which the gate refuses. */}
          <p className="text-sm text-text">
            Type <code className="font-mono text-accent-muted">{CLEAR_GATE_WORD}</code> to confirm
          </p>
          <Input
            value={typed}
            onChange={setTyped}
            onKeyDown={(e) => {
              if (e.key === "Enter" && gated) void clear();
            }}
            placeholder={CLEAR_GATE_WORD}
            aria-label={`Type ${CLEAR_GATE_WORD} to confirm`}
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <Button variant="danger" disabled={!gated || busy} onClick={() => void clear()}>
              {busy ? "Clearing…" : "Clear all saved data"}
            </Button>
            {typed.length > 0 && !gated && (
              <span className="text-xs text-text-muted">
                Type the whole word: it is the point of the confirmation.
              </span>
            )}
          </div>
        </div>

        {notice && result && <ClearResult notice={notice} report={result} />}
      </div>
    </Section>
  );
}

/** One line of what the action will remove, before it does. */
function ClearTarget({ children }: { children: string }) {
  return (
    <li className="flex max-w-prose gap-2 text-xs leading-relaxed text-text-muted">
      <span aria-hidden className="mt-1.5 block h-1 w-1 shrink-0 rounded-full bg-text-muted/60" />
      <span>{children}</span>
    </li>
  );
}

/**
 * What the action did, exactly.
 *
 * The list is built from the report rather than from a count, so a line that
 * says a thing was removed can only appear when it was. The header is the
 * notice's leading word — "Cleared all saved data." or "Clearing stopped: …" —
 * so which of the two happened is said in words and not only in colour, and
 * `role="status"` keeps it announced as the report of something just done.
 */
function ClearResult({ notice, report }: { notice: ClearNotice; report: ClearReport }) {
  return (
    <Notice tone={notice.tone} role="status" label={notice.title}>
      <p className="max-w-prose text-xs leading-relaxed text-text-muted">{notice.detail}</p>
      {report.removed.length > 0 && (
        <ul className="flex flex-col gap-1">
          {report.removed.map((item) => (
            <li key={`${item.target}:${item.detail}`} className="text-xs leading-relaxed">
              <span className="text-text">
                {CLEAR_TARGET_LABEL[item.target]}
                {item.bytes === undefined ? ":" : ` (${item.bytes.toLocaleString()} bytes):`}
              </span>{" "}
              <code className="select-text break-all font-mono text-[11px] text-text-muted">
                {item.detail}
              </code>
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}
