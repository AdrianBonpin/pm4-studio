import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lock, ScanLine } from "lucide-react";
import { Button } from "./ui/Button";
import { Notice } from "./ui/Notice";
import { Field, Section } from "./Section";
import { beginDeviceOperation } from "../lib/deviceLock";
import { describeDeviceFailure } from "../lib/readerIdentity";
import {
  ACKNOWLEDGEMENT_LABEL,
  CONFIG_READ_EXPLANATION,
  NO_AUTHENTICATION_EXPLANATION,
  PASSWORD_ACTION_REMOVE,
  PASSWORD_ACTION_SET,
  UNKNOWN_PASSWORD_WARNING,
  acknowledgementGiven,
  gateRefusal,
  pagesSentence,
  passwordConfirmation,
  passwordNotice,
  protectionSentence,
  type PasswordAttempt,
  type PasswordOperation,
  type PasswordStatus,
} from "../lib/password";

interface PasswordProtectionProps {
  connected: boolean;
}

/**
 * Password protection: set and remove, both refused, and the reason stated
 * plainly rather than left as a disabled button.
 *
 * **Not rendered by any page.** Ticket 14 removed this panel from 13.56 MHz: it
 * was half a screen of explanation in front of two controls that can never work
 * on this Reader, and the one fact worth keeping is recorded with the other
 * capability limits in Settings → Diagnostics. The component and its Rust side
 * are kept because the operations exist in the protocol, and a page that asked
 * for them again would find the refusal honest rather than new.
 *
 * The shape of this panel is the point of the ticket. There is a warning that a
 * lost password makes the Tag permanently unrecoverable; there is an
 * acknowledgement that has to be given before either operation can even be
 * asked for; and there is a real answer when it is asked for, explaining that
 * this Reader cannot authenticate so it will not set protection it cannot
 * satisfy or clear. The gate is not decoration: the acknowledgement is
 * necessary, and the Rust side (`src-tauri/src/password.rs`) is what makes it
 * insufficient.
 *
 * Nothing here writes. "Read the tag" sends `0x0083` and `0x0081`; the two
 * password commands send no frame at all and do not even open the Reader.
 */
export function PasswordProtection({ connected }: PasswordProtectionProps) {
  const [status, setStatus] = useState<PasswordStatus | null>(null);
  const [reading, setReading] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState<PasswordAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    setReading(true);
    setError(null);
    setAttempt(null);
    // A stale reading under a different Tag's heading is worse than none.
    setStatus(null);
    const release = beginDeviceOperation();
    try {
      setStatus(await invoke<PasswordStatus>("hf_password_status"));
    } catch (e) {
      setError(describeDeviceFailure(e));
    } finally {
      release();
      setReading(false);
    }
  };

  const run = async (operation: PasswordOperation) => {
    if (!acknowledgementGiven(acknowledged)) return;
    setError(null);
    const release = beginDeviceOperation();
    try {
      const result = await invoke<PasswordAttempt>(
        operation === "set" ? "hf_password_set" : "hf_password_remove",
        { acknowledged },
      );
      setAttempt(result);
    } catch (e) {
      setError(describeDeviceFailure(e));
    } finally {
      release();
      // The acknowledgement is per attempt: nothing is remembered, so the next
      // request has to be acknowledged again.
      setAcknowledged(false);
    }
  };

  const setConfirmation = passwordConfirmation("set", status?.uid ?? null);
  const removeConfirmation = passwordConfirmation("remove", status?.uid ?? null);
  const gated = gateRefusal(acknowledged) !== null;

  return (
    <Section
      title="Password protection"
      hint="NTAG21x PWD / PACK / AUTH0. Reading the state is possible; setting or removing a password is not, and this panel says why."
      actions={
        <Button variant="secondary" disabled={!connected || reading} onClick={() => void read()}>
          <ScanLine size={13} /> {reading ? "Reading…" : "Read the tag"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="err" label={setConfirmation.warning}>
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            {setConfirmation.unrecorded}
          </p>
        </Notice>

        {!connected && (
          <p className="text-xs leading-relaxed text-text-muted">
            Connect the Reader to read a Tag's protection state. Nothing on this panel needs a
            Reader to be explained, which is why the warning is shown first.
          </p>
        )}

        {error && (
          <Notice tone="err" label="Failed">
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">{error}</p>
          </Notice>
        )}

        {status && (
          <div className="flex flex-col gap-3">
            <Field label="Tag" value={status.uid ?? "no Tag read"} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Field
                label="User memory"
                value={
                  status.capacityBytes === null ? "unknown" : `${status.capacityBytes} bytes`
                }
                tone="muted"
              />
              <Field
                label={`Page 131 ${status.configurationReal ? "(AUTH0)" : "(as read)"}`}
                value={status.auth0PageRead ?? "not read"}
                tone="muted"
              />
              <Field
                label={`Page 133 ${status.configurationReal ? "(PWD)" : "(as read)"}`}
                value={status.pwdPageRead ?? "not read"}
                tone="muted"
              />
              <Field
                label={`Page 134 ${status.configurationReal ? "(PACK)" : "(as read)"}`}
                value={status.packPageRead ?? "not read"}
                tone="muted"
              />
            </div>

            <Notice tone="warn" label={protectionSentence(status.protection)}>
              <p className="max-w-prose text-xs leading-relaxed text-text-muted">
                {status.whyUnknown}
              </p>
              {!status.configurationReal && (
                <p className="max-w-prose text-xs leading-relaxed text-text-muted">
                  {CONFIG_READ_EXPLANATION}
                </p>
              )}
              <p className="max-w-prose text-xs leading-relaxed text-text-muted">
                {UNKNOWN_PASSWORD_WARNING}
              </p>
            </Notice>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-sm text-text">
            <Lock size={13} /> Setting a password is not offered
          </p>
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            {NO_AUTHENTICATION_EXPLANATION}
          </p>
          <ul className="flex flex-col gap-2">
            {setConfirmation.facts.map((fact) => (
              <li key={fact.title} className="text-xs leading-relaxed text-text-muted">
                <span className="text-text">{fact.title}.</span> {fact.detail}
              </li>
            ))}
          </ul>
          <p className="font-mono text-[11px] text-text-muted">
            set → {pagesSentence(setConfirmation.pages)} · remove →{" "}
            {pagesSentence(removeConfirmation.pages)}
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-canvas px-3 py-2">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent"
          />
          <span className="text-xs leading-relaxed text-text-muted">
            {ACKNOWLEDGEMENT_LABEL}
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={gated}
            onClick={() => void run("set")}
            title={gateRefusal(acknowledged) ?? "This Reader cannot set a password"}
          >
            {PASSWORD_ACTION_SET}
          </Button>
          <Button
            variant="ghost"
            disabled={gated}
            onClick={() => void run("remove")}
            title={gateRefusal(acknowledged) ?? "This Reader cannot remove a password"}
          >
            {PASSWORD_ACTION_REMOVE}
          </Button>
          <span className="text-[11px] leading-relaxed text-text-muted">
            Both are refused even when acknowledged: the acknowledgement is required, and it is
            not what is missing.
          </span>
        </div>

        {attempt && (
          <Notice tone={passwordNotice(attempt).tone} label={passwordNotice(attempt).text}>
            <p className="font-mono text-[11px] text-text-muted">
              refusal: {attempt.refusal} · {" "}
              {pagesSentence(attempt.wouldWritePages)} · pages written:{" "}
              {attempt.wrotePages.length}
            </p>
          </Notice>
        )}
      </div>
    </Section>
  );
}
