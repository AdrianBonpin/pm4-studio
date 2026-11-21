/**
 * Reader identity: the firmware revision the hardware reports, the failures it
 * can produce, and the capability limits of this Reader stated once.
 *
 * Everything here is pure so it can be tested with no Reader attached. The
 * device handle stays in Rust; this module only interprets what Rust returns.
 */

/** What went wrong, in terms a user can act on. */
export type DeviceFailure = "absent" | "claimed" | "wedged" | "unknown";

export interface DeviceFailureNotice {
  tone: "muted" | "warn" | "error";
  title: string;
  detail: string;
}

/**
 * The limits of this Reader, stated once for the whole app.
 *
 * Render this list from one place (`components/ReaderLimits.tsx`) and never
 * repeat an entry against an individual Tag: a missing field is a property of
 * this hardware, not of the Tag being read.
 */
export interface CapabilityLimit {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export const READER_CAPABILITY_LIMITS: readonly CapabilityLimit[] = [
  {
    id: "ndef",
    label: "NDEF messages",
    detail:
      "Not readable or writable today. The NTAG commands that carry NDEF have never answered on this Reader, so a 13.56 MHz Tag reports its UID and its raw payload only.",
  },
  {
    id: "mifare-classic",
    label: "MIFARE Classic sectors",
    detail:
      "Not readable. Sector access needs key authentication and this protocol exposes no key command, so only the UID is available.",
  },
  {
    id: "apdu",
    label: "APDU passthrough",
    detail:
      "Not available. Without a transparent APDU channel there is no Signature, authenticated NFC counter, or password-protection status.",
  },
  {
    id: "uid-width",
    label: "7- and 10-byte UIDs",
    detail:
      "Not decoded. Only 4-byte UIDs are split out; a longer UID is shown as raw bytes.",
  },
  {
    id: "restore",
    label: "Factory restore and unlock",
    detail:
      "Not possible. A T5577 configuration block cannot be written, and a Tag locked by an earlier write cannot be recovered.",
  },
  {
    // Stated once, here, so a missing check reads as a documented limit rather
    // than a missing feature (ADR 0007). The absence is deliberate and permanent.
    id: "writability",
    label: "125 kHz writability",
    detail:
      "Cannot be determined without attempting a write. A 125 kHz reply carries no Tag family and no writability flag, so no command can answer whether a Tag will accept a write — and every command that would answer is itself a write. There is therefore no probe, in this app or in the protocol, and none is planned: Reset is the test.",
  },
];

/**
 * Firmware revision exactly as it should be shown. The Reader pads its reply
 * with NUL bytes, so the value is trimmed and stripped of control characters;
 * an absent or empty revision reads "unknown" rather than a bare blank.
 */
export function formatFirmwareRevision(raw: string | null | undefined): string {
  const cleaned = (raw ?? "")
    // Keep only what the firmware can legitimately print.
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  return cleaned === "" ? "unknown" : cleaned;
}

/**
 * Map a Rust error string onto the three failures that have a distinct remedy.
 * An ordinary message ("no tag on the reader") stays `unknown` so it keeps its
 * own wording instead of being rewritten as a hardware fault.
 */
export function classifyDeviceFailure(message: string): DeviceFailure {
  const text = message ?? "";
  // The opaque macOS status behind a second holder of the exclusive handle.
  if (/0xE00002C5|kIOReturnExclusiveAccess|exclusive access/i.test(text)) {
    return "claimed";
  }
  // Transport accepted the frame but the firmware stopped answering, which is
  // the documented wedge: only a physical replug clears it.
  if (
    /I\/O Timeout|IOHIDDeviceSetReport|timed out|stopped answering|stopped responding|not responding|did not report|did not answer|did not respond|unplug|replug/i.test(
      text,
    )
  ) {
    return "wedged";
  }
  if (
    /not found|no such device|no reader|not attached|kIOReturnNotAttached|hid_open|failed to open/i.test(
      text,
    )
  ) {
    return "absent";
  }
  return "unknown";
}

/** Title, remedy and tone for a failure, ready to render. */
export function deviceFailureNotice(failure: DeviceFailure): DeviceFailureNotice {
  switch (failure) {
    case "absent":
      return {
        tone: "muted",
        title: "No Reader attached",
        detail:
          "Plug the NFC-PM4 Reader into a USB port and press Connect. Everything in the library stays usable without it.",
      };
    case "claimed":
      return {
        tone: "error",
        title: "The Reader is held by another process",
        detail:
          "Another copy of this app, or another app, already has the Reader open. Close it, then press Reconnect — the Reader accepts one holder at a time.",
      };
    case "wedged":
      return {
        tone: "warn",
        title: "The Reader stopped responding",
        detail:
          "Unplug the Reader, plug it back in, and press Reconnect. The firmware stays wedged until it is physically replugged.",
      };
    default:
      return {
        tone: "error",
        title: "The operation failed",
        detail: "Nothing was written. Check the Reader and try again.",
      };
  }
}

/**
 * One line for an inline error slot. Hardware faults are replaced by their
 * remedy; anything else keeps its own message.
 */
export function describeDeviceFailure(raw: unknown): string {
  const message =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw ?? "");
  const failure = classifyDeviceFailure(message);
  if (failure === "unknown") {
    const trimmed = message.trim();
    return trimmed === "" ? "The operation failed." : trimmed;
  }
  const notice = deviceFailureNotice(failure);
  return `${notice.title}. ${notice.detail}`;
}
