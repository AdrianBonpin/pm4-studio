import { describe, expect, it } from "vitest";
import { decodeHfPayload } from "./hfDecoder";
import { decodeRecords, encodeRecords } from "./ndef";
import {
  READER_CAPABILITY_LIMITS,
  classifyDeviceFailure,
  describeDeviceFailure,
  deviceFailureNotice,
  formatFirmwareRevision,
} from "./readerIdentity";

describe("formatFirmwareRevision", () => {
  it("shows the revision the Reader reports", () => {
    expect(formatFirmwareRevision("H00S07")).toBe("H00S07");
  });

  it("trims padding the firmware sends after the string", () => {
    expect(formatFirmwareRevision(" H00S07 \u0000\u0000")).toBe("H00S07");
  });

  it("says unknown rather than showing an empty value", () => {
    expect(formatFirmwareRevision(null)).toBe("unknown");
    expect(formatFirmwareRevision(undefined)).toBe("unknown");
    expect(formatFirmwareRevision("")).toBe("unknown");
    expect(formatFirmwareRevision("\u0000\u0000\u0000")).toBe("unknown");
    expect(formatFirmwareRevision("   ")).toBe("unknown");
  });
});

describe("classifyDeviceFailure", () => {
  it("recognises a Reader that is not plugged in", () => {
    expect(
      classifyDeviceFailure("reader not found (0483:4343): hid_open failed"),
    ).toBe("absent");
    expect(classifyDeviceFailure("No such device")).toBe("absent");
  });

  it("recognises the exclusive-access error as another holder of the Reader", () => {
    // The opaque macOS status the app must never surface as a bare code.
    expect(
      classifyDeviceFailure(
        "failed to open hid device: (0xE00002C5) kIOReturnExclusiveAccess",
      ),
    ).toBe("claimed");
    expect(classifyDeviceFailure("Exclusive access is denied")).toBe("claimed");
  });

  it("recognises a wedged firmware from its transport timeout", () => {
    expect(
      classifyDeviceFailure(
        "USB write failed: IOHIDDeviceSetReport failed: (0xE00002D8) (I/O Timeout)",
      ),
    ).toBe("wedged");
    expect(classifyDeviceFailure("USB read failed: hid_read_timeout timed out")).toBe(
      "wedged",
    );
    expect(classifyDeviceFailure("the reader stopped answering HID reports")).toBe(
      "wedged",
    );
  });

  it("recognises a firmware that never answered as wedged", () => {
    // The message Rust returns when a frame is accepted but no reply arrives.
    expect(
      classifyDeviceFailure(
        "the reader did not report a firmware revision. Unplug it, plug it back in, and press Reconnect.",
      ),
    ).toBe("wedged");
  });

  it("leaves an ordinary message unclassified", () => {
    expect(classifyDeviceFailure("")).toBe("unknown");
    expect(
      classifyDeviceFailure(
        "could not read the tag on the reader, so refusing to write blind. " +
          "Put a blank 125 kHz tag on the reader and try again.",
      ),
    ).toBe("unknown");
  });
});

describe("deviceFailureNotice", () => {
  it("states plainly that no Reader is attached", () => {
    const notice = deviceFailureNotice("absent");
    expect(notice.title).toMatch(/no reader attached/i);
    expect(notice.detail).toMatch(/cable|usb/i);
  });

  it("tells the user to replug a wedged Reader", () => {
    const notice = deviceFailureNotice("wedged");
    expect(notice.detail).toMatch(/unplug/i);
    expect(notice.detail).toMatch(/plug (it )?back in|replug/i);
    expect(notice.tone).toBe("warn");
  });

  it("names the competing process for an exclusive-access failure", () => {
    const notice = deviceFailureNotice("claimed");
    expect(notice.detail).toMatch(/another copy|another app|other process/i);
    expect(notice.detail).not.toMatch(/0x[0-9A-F]{8}/i);
  });
});

describe("describeDeviceFailure", () => {
  it("replaces opaque transport errors with the remedy", () => {
    const wedged = describeDeviceFailure(
      "USB write failed: IOHIDDeviceSetReport failed: (0xE00002D8) (I/O Timeout)",
    );
    expect(wedged).toMatch(/unplug/i);
    expect(wedged).not.toMatch(/0xE00002D8/);
  });

  it("passes an unrelated message through untouched", () => {
    const guard =
      "could not read the tag on the reader, so refusing to write blind. " +
      "Put a blank 125 kHz tag on the reader and try again.";
    expect(describeDeviceFailure(guard)).toBe(guard);
  });

  it("accepts an Error as well as a string", () => {
    expect(describeDeviceFailure(new Error("No such device"))).toMatch(
      /no reader attached/i,
    );
  });
});

describe("READER_CAPABILITY_LIMITS", () => {
  it("states each limit once, in one list", () => {
    const ids = READER_CAPABILITY_LIMITS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const limit of READER_CAPABILITY_LIMITS) {
      expect(limit.label.trim()).not.toBe("");
      expect(limit.detail.trim()).not.toBe("");
    }
  });

  it("names the operations this Reader cannot perform", () => {
    const text = READER_CAPABILITY_LIMITS.map((l) => `${l.label} ${l.detail}`)
      .join(" ")
      .toLowerCase();
    expect(text).toContain("ndef");
    expect(text).toContain("mifare classic");
    expect(text).toContain("apdu");
    // Ticket 14 removed the password panel from 13.56 MHz; the capability is
    // recorded here instead, once, with the rest of the limits.
    expect(text).toContain("password");
  });

  it("never calls a Tag a badge or a fob", () => {
    for (const limit of READER_CAPABILITY_LIMITS) {
      expect(`${limit.label} ${limit.detail}`).not.toMatch(/\bbadge\b|\bfob\b/i);
    }
  });

  it("records, once, that 125 kHz writability cannot be determined without a write", () => {
    // ADR 0007: the absence of a writability check is a documented limit, so a
    // user who goes looking for one finds the reason instead of an oversight.
    const writability = READER_CAPABILITY_LIMITS.filter((limit) =>
      /writability/i.test(`${limit.label} ${limit.detail}`),
    );
    expect(writability).toHaveLength(1);

    const [limit] = writability;
    const text = `${limit?.label} ${limit?.detail}`;
    expect(text).toMatch(/cannot be determined/i);
    expect(text).toMatch(/without attempting a write/i);
    expect(text).toMatch(/125 kHz/i);
    // And that there is no probe, so nothing implies one could be built.
    expect(text).toMatch(/no probe/i);
  });
});

/** The recorded NTAG215 capture: 7-byte UID `04 43 8A 01 22 09 03`, taken from
 *  this Reader. Evidence: docs/PROTOCOL.md, "The verified HF reply layout". */
const NTAG_CAPTURE = [
  0x01, 0x01,
  0x04, 0x43, 0x8a, 0x01, 0x22, 0x09, 0x03, 0x1d, 0x00, 0x20,
  0x07, // the reply's own UID length byte
  0x44, 0x00,
  0x00,
  0x02,
  0x00, 0x00,
];

/** The same shape with a stated 10-byte UID. No 10-byte Tag has been tried on
 *  hardware, which is an open question rather than a limit. */
const TEN_BYTE_UID_CAPTURE = [
  0x01, 0x01,
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
  0x0a,
  0x44, 0x00,
  0x00,
  0x03,
  0x00, 0x00,
];

/**
 * The claims the limits list must never make again, each with the surface that
 * refutes it.
 *
 * The list is the one place the app states what this Reader cannot do, so a
 * limit that outlives the work that removed it is worse than no limit at all:
 * it tells the user a capability is missing in the panel they opened to explain
 * the feature in the next tab. Ticket 19's sweep could not catch this because it
 * matches source patterns rather than checking whether a sentence is still true,
 * which is why the words themselves are pinned here.
 *
 * Each `refutedBy` names the implementing module, and the tests below exercise
 * those modules, so the guard cannot pass by the capability having been deleted.
 */
const CLAIMS_THAT_MUST_NOT_RETURN: readonly {
  readonly id: string;
  readonly claim: RegExp;
  readonly refutedBy: string;
}[] = [
  {
    id: "ndef",
    claim: /not readable or writable|never answered|raw payload only/i,
    refutedBy:
      "tickets 06, 08 and 15: a Type 2 Tag's NDEF message is read into Records, written from a " +
      "Draft, copied and erased; the write is verified on hardware (docs/PROTOCOL.md, spike 16).",
  },
  {
    id: "uid-width",
    claim: /\braw bytes?\b|not decoded|only 4-byte/i,
    refutedBy:
      "ticket 06: the decoder splits the reply's own UID length byte, so 4-, 7- and 10-byte " +
      "widths decode, and the 7-byte hardware capture below is in the repo.",
  },
];

describe("the capability limits cannot contradict a capability the app ships", () => {
  it("keeps an entry for every capability that must not be denied", () => {
    // A rename would otherwise turn the guard below into a test of nothing.
    for (const { id } of CLAIMS_THAT_MUST_NOT_RETURN) {
      expect(
        READER_CAPABILITY_LIMITS.some((limit) => limit.id === id),
        `a limit entry with id "${id}"`,
      ).toBe(true);
    }
  });

  it("does not deny a capability the app implements", () => {
    for (const { id, claim, refutedBy } of CLAIMS_THAT_MUST_NOT_RETURN) {
      const limit = READER_CAPABILITY_LIMITS.find((entry) => entry.id === id);
      const text = `${limit?.label} ${limit?.detail}`;
      expect(text, `the ${id} limit: ${refutedBy}`).not.toMatch(claim);
    }
  });

  it("states NDEF as available through the Type 2 TLV, so the entry is not merely silent", () => {
    const limit = READER_CAPABILITY_LIMITS.find((entry) => entry.id === "ndef");
    const text = `${limit?.label} ${limit?.detail}`;
    expect(text).toMatch(/read/i);
    expect(text).toMatch(/writ/i);
    expect(text).toMatch(/Type 2/i);
    expect(text).toMatch(/Records?/i);
  });

  it("states which UID widths decode, and that 10 bytes is unconfirmed on hardware", () => {
    const limit = READER_CAPABILITY_LIMITS.find((entry) => entry.id === "uid-width");
    const text = `${limit?.label} ${limit?.detail}`;
    // The widths themselves: 4, 7 and 10, from the reply's own length byte.
    expect(text).toMatch(/\b4\b/);
    expect(text).toMatch(/\b7\b/);
    expect(text).toMatch(/\b10\b/);
    expect(text).toMatch(/length byte/i);
    // The spec's open question, stated as one rather than as a limit.
    expect(text).toMatch(/10-byte/i);
    expect(text).toMatch(/hardware|confirmed|verified|tried/i);
  });

  it("refutes the NDEF claim with the codec that reads and writes a message", () => {
    // Read: a message decodes into Records. Write: the same Records encode back
    // into a message. Both verbs the old entry denied, in one round trip.
    const message = encodeRecords([{ kind: "text", fields: { language: "en", text: "hi" } }]);
    const records = decodeRecords(message);
    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe("text");
  });

  it("refutes the UID claim with the decoder that splits a 7-byte UID", () => {
    const reading = decodeHfPayload(NTAG_CAPTURE);
    expect(reading.state).toBe("decoded");
    if (reading.state !== "decoded") return;
    expect(reading.uid).toBe("04 43 8A 01 22 09 03");
    expect(reading.uid.split(" ")).toHaveLength(7);
  });

  it("splits a 10-byte UID too, which is what the entry now claims", () => {
    const reading = decodeHfPayload(TEN_BYTE_UID_CAPTURE);
    expect(reading.state).toBe("decoded");
    if (reading.state !== "decoded") return;
    expect(reading.uid.split(" ")).toHaveLength(10);
  });
});

describe("the writability limit is untouched by the NDEF correction", () => {
  it("still says a write is the only test", () => {
    // Ticket 12's limit is the one entry that must survive verbatim; a sweep of
    // the list for stale claims must not tidy it away with the corrected ones.
    const limit = READER_CAPABILITY_LIMITS.find((entry) => entry.id === "writability");
    const text = `${limit?.label} ${limit?.detail}`;
    expect(text).toMatch(/without attempting a write/i);
    expect(text).toMatch(/Reset is the test/i);
  });
});
