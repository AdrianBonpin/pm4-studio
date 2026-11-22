/**
 * Password protection on an NTAG21x: the warning the user must read, the gate
 * that has to be passed before an operation can even be asked for, and the words
 * for what came of it.
 *
 * The important thing this module encodes is **what this app will not do**. On
 * an NTAG21x, protection is three configuration pages — `AUTH0` on 131, `PWD` on
 * 133, `PACK` on 134 — and once `AUTH0` names a page, every access at or after it
 * needs a `PWD_AUTH` command carrying the password. This Reader's protocol has
 * no authentication command of any kind (docs/PROTOCOL.md: `0x0083` info,
 * `0x0081` read, `0x0082` write, `0x0085` progress, `0x0084` format, and nothing
 * else). So the app cannot satisfy a password it sets, and cannot get back in to
 * clear one: the write that would put `AUTH0` back to `0xFF` is itself behind the
 * protection it clears.
 *
 * A second, independent reason: this firmware's configuration-area read is not
 * the Tag's real configuration. `AUTH0` reads `0x04` on every Tag, including
 * Tags whose user memory reads back in full — which a real `AUTH0` of `4` would
 * forbid. So protection status cannot be determined, and a Tag is never
 * presented as recoverable on the strength of it.
 *
 * The Rust side (`src-tauri/src/password.rs`) has no success path at all, so the
 * wording here and that decision cannot drift apart into a working "set".
 */

import type { NoticeTone } from "./noticeTone";
import type { WriteNotice } from "./writeOutcome";

/** The verb this feature uses for itself, setting. */
export const PASSWORD_ACTION_SET = "Set a password";
/** The verb this feature uses for itself, removing. */
export const PASSWORD_ACTION_REMOVE = "Remove the password";

/** The operation a confirmation is about. */
export type PasswordOperation = "set" | "remove";

/** The one sentence the whole feature exists for. */
export const LOST_PASSWORD_WARNING =
  "If the password is lost, this Tag is permanently unrecoverable: no reader can read it, " +
  "write it or identify it without the password, and nothing can be recovered from it without it.";

/** Said at the point of setting: what happens if the password is not written down. */
export const UNRECORDED_PASSWORD_WARNING =
  "A password that is not recorded anywhere is a lost password. This app does not store it, " +
  "does not show it back to you, and cannot recover it or the Tag. Write it down somewhere you " +
  "will still have it before any password is set — and keep that note apart from the Tag.";

/** Never softened: an unknown password means no recovery, not "try something". */
export const UNKNOWN_PASSWORD_WARNING =
  "A Tag whose password is unknown is never presented as recoverable here. This Reader cannot " +
  "read a Tag's real AUTH0, so it cannot tell you whether a Tag is protected; and it has no way " +
  "to authenticate one. Treat such a Tag as unreachable rather than as something to experiment on.";

/** Why setting is not offered, in one paragraph, without jargon. */
export const NO_AUTHENTICATION_EXPLANATION =
  "This Reader has no command that authenticates a 13.56 MHz Tag, so password protection is " +
  "one-way here. Setting a password writes AUTH0, PWD and PACK into the Tag's configuration " +
  "pages; after that, every read and write at or after AUTH0 needs the password. Clearing it " +
  "again means writing AUTH0 back to 0xFF — a write the protected Tag will refuse without the " +
  "password. The app will therefore not set one.";

/** Why reading the protection state is not offered either. */
export const CONFIG_READ_EXPLANATION =
  "The configuration area this Reader reports is not the Tag's real configuration. Page 131 " +
  "reads AUTH0 = 04 on every Tag, including Tags whose whole user area reads back fine — " +
  "which a real AUTH0 of 4 would forbid. Protection status is therefore unknown, not \"off\".";

/** The label on the acknowledgement. Deliberately a whole sentence. */
export const ACKNOWLEDGEMENT_LABEL =
  "I understand that a lost password makes this Tag permanently unrecoverable, and that this " +
  "app can neither recover it nor remove the protection.";

/** Config pages each operation would have to change, if it were possible. */
export const SET_PAGES: readonly number[] = [131, 133, 134];
export const REMOVE_PAGES: readonly number[] = [131];

/** One consequence stated before the operation is offered. */
export interface PasswordFact {
  readonly title: string;
  readonly detail: string;
}

/**
 * The consequences, each one something the user cannot discover afterwards
 * without having lost a Tag to it.
 */
export const PASSWORD_FACTS: readonly PasswordFact[] = [
  {
    title: "The password cannot be verified",
    detail:
      "Protection can only be confirmed by authenticating with the password, and this Reader " +
      "cannot authenticate. A password set by any means here would be unproven as well as " +
      "unremovable.",
  },
  {
    title: "Setting it is one-way over this protocol",
    detail:
      "Once AUTH0 names a page, the write that would put it back to 0xFF is behind that same " +
      "protection. Getting back in needs an authentication command this protocol does not have.",
  },
  {
    title: "The app cannot see whether a Tag is already protected",
    detail:
      "The configuration pages this Reader reports are a firmware artifact, not the Tag's real " +
      "settings, so a protected Tag is not distinguishable from an unprotected one.",
  },
];

/** A confirmation, ready to render. Nothing here can be defaulted to "yes". */
export interface PasswordConfirmation {
  readonly operation: PasswordOperation;
  /** Heading: the action, and the Tag it would apply to when one was read. */
  readonly title: string;
  readonly action: string;
  readonly warning: string;
  readonly unrecorded: string;
  readonly acknowledgementLabel: string;
  readonly facts: readonly PasswordFact[];
  /** Configuration pages the operation would change. Never written. */
  readonly pages: readonly number[];
}

/**
 * Build the confirmation for one operation.
 *
 * `uid` is what the user saw read from the Tag, so the heading cannot name a Tag
 * the app did not see. `null` means nothing was read, and the heading says "this
 * Tag" rather than inventing one.
 */
export function passwordConfirmation(
  operation: PasswordOperation,
  uid: string | null,
): PasswordConfirmation {
  const which = uid === null ? "this Tag" : `${uid}`;
  return {
    operation,
    title:
      operation === "set"
        ? `Set a password on ${which}? This cannot be undone here.`
        : `Remove the password from ${which}?`,
    action: operation === "set" ? PASSWORD_ACTION_SET : PASSWORD_ACTION_REMOVE,
    warning: LOST_PASSWORD_WARNING,
    unrecorded: UNRECORDED_PASSWORD_WARNING,
    acknowledgementLabel: ACKNOWLEDGEMENT_LABEL,
    facts: PASSWORD_FACTS,
    pages: operation === "set" ? SET_PAGES : REMOVE_PAGES,
  };
}

/**
 * The acknowledgement gate.
 *
 * `true` only for an explicit acknowledgement. There is no default and no
 * "already agreed" state: an entry point that forgot to collect one gets `false`
 * and cannot proceed. This is what makes the dialog behind it not
 * default-accepted.
 */
export function acknowledgementGiven(acknowledged: boolean): boolean {
  return acknowledged === true;
}

/**
 * Why an operation is unavailable, or `null` when the gate is passed.
 *
 * The buttons use this, so an unacknowledged request is not merely refused after
 * the fact — it cannot be asked for.
 */
export function gateRefusal(acknowledged: boolean): string | null {
  return acknowledgementGiven(acknowledged) ? null : ACKNOWLEDGEMENT_LABEL;
}

// ---- what the Reader answered ------------------------------------------

/** Protection state as the backend reports it. */
export type ProtectionState = "unknown" | "disabled" | "enabled";

/** What can be determined about the Tag on the Reader. A read, nothing more. */
export interface PasswordStatus {
  uid: string | null;
  capacityBytes: number | null;
  protection: ProtectionState;
  whyUnknown: string;
  /** Page 131 as the Reader returned it. Not the Tag's AUTH0. */
  auth0PageRead: string | null;
  pwdPageRead: string | null;
  packPageRead: string | null;
  /** False: the configuration-area read is not real configuration. */
  configurationReal: boolean;
  setPages: number[];
  removePages: number[];
  readerCanAuthenticate: boolean;
}

/** What one requested operation came to. */
export interface PasswordAttempt {
  outcome: "refused";
  /** "not-acknowledged" | "cannot-authenticate" | "protection-unknown" | ... */
  refusal: string;
  message: string;
  wouldWritePages: number[];
  /** Always empty: no frame is sent for either operation. */
  wrotePages: number[];
}

/**
 * The protection line, in the only three shapes it can take.
 *
 * "Cannot be determined" is the one this Reader produces, and it is never
 * shortened to "off" — that is the sentence that would invite a user to treat a
 * protected Tag as a working one.
 */
export function protectionSentence(protection: ProtectionState): string {
  switch (protection) {
    case "disabled":
      return "Protection: AUTH0 reads 0xFF, so no page requires a password.";
    case "enabled":
      return "Protection: a password is required for part of this Tag. This Reader cannot authenticate it, so the Tag is not recoverable here.";
    case "unknown":
      return "Protection: cannot be determined. This is not the same as unprotected, and the Tag is not treated as recoverable.";
  }
}

/** One line about how the outcome is worded, given the refusal code. */
export function noticeTone(attempt: PasswordAttempt): NoticeTone {
  // Not acknowledging is a user action, not a Tag risk: amber. Everything else
  // is the app declining to touch the Tag: red.
  return attempt.refusal === "not-acknowledged" ? "warn" : "err";
}

/**
 * What to tell the user about one attempt.
 *
 * Every attempt is a refusal, and the wording says so before it says why: no
 * password operation has ever produced a write frame on this Reader.
 */
export function passwordNotice(attempt: PasswordAttempt): WriteNotice {
  const why = attempt.message.trim();
  return {
    tone: noticeTone(attempt),
    text: `Not done — nothing was written to the Tag. ${why}`,
  };
}

/** The pages an attempt would have touched, as prose. */
export function pagesSentence(pages: readonly number[]): string {
  if (pages.length === 0) return "No configuration page would be touched.";
  const list = pages.join(", ");
  return `Configuration page${pages.length === 1 ? "" : "s"} ${list} would have to change. None was written.`;
}
