import { describe, expect, it } from "vitest";
import {
  compareMessages,
  copyDecision,
  copyDestination,
  copyEvidence,
  copyMessage,
  copyOutcome,
  copySource,
  observeField,
  requiredBytes,
  type CopyDecision,
  type CopyDestination,
  type CopyFieldObservation,
  type CopyMessage,
  type CopyWriteEvidence,
} from "./hfCopy";
import { assembleHfRead } from "./hfRead";
import {
  decodeRecords,
  encodeNdefMessage,
  encodeRecords,
  textRecord,
  type NdefRecord,
} from "./ndef";
import { signalOf } from "./outcome";
import { bytesToHex, type NdefWriteResult } from "./tagWrite";
import { decodeHfPayload } from "./hfDecoder";
import { dump } from "../test/hfState";
import type { DraftRecord } from "./drafts";
import type { TagRecordsRead } from "./tagRecords";
import type { HfCard, NdefTagSnapshot } from "../types";

/**
 * Ticket 15 — the Copy guard: a decision in, a decision out, no device.
 *
 * Copy is a guided flow that protects the Tag it is reading from, and every
 * branch below is a thing the flow must refuse or allow. The tests are written
 * where the decision is made rather than through a render, because the whole
 * reason the guard is pure is that these branches must be reachable without a
 * Reader, a Tag, or hardware of any kind.
 *
 * The refusals are the valuable half: a source that was not removed, a
 * destination that cannot be read, a destination that already holds the message,
 * a message that does not fit, and an undetermined capacity that is not allowed
 * to mean "it fits".
 */

const SOURCE_UID = "04 43 8A 01 22 09 03";
const DESTINATION_UID = "04 A2 24 5A 6C 71 80";

const SOURCE_RECORDS: readonly DraftRecord[] = [
  { kind: "text", fields: { language: "en", text: "hello" } },
  { kind: "url", fields: { url: "https://devgo.studio" } },
];

const OTHER_RECORDS: readonly DraftRecord[] = [
  { kind: "text", fields: { language: "en", text: "loading bay" } },
];

/** The message the flow holds after reading the source Tag. */
function source(): CopyMessage {
  return copyMessage(SOURCE_UID, SOURCE_RECORDS);
}

/** The destination as the flow read it: a Tag holding a different message. */
function destination(patch: Partial<CopyDestination> = {}): CopyDestination {
  return {
    uid: DESTINATION_UID,
    latched: true,
    holds: "records",
    message: copyMessage(DESTINATION_UID, OTHER_RECORDS),
    problem: null,
    capacityBytes: 496,
    ...patch,
  };
}

/** The write's own evidence, from the backend's read-back. */
function evidence(
  outcome: CopyWriteEvidence["outcome"],
  readback: CopyMessage | null,
  reason: string | null = null,
): CopyWriteEvidence {
  return { outcome, reason, readback };
}

/** The NDEF message length, as the hex holds it. */
function messageBytes(message: CopyMessage): number {
  return message.messageHex === "" ? 0 : message.messageHex.split(" ").length;
}

/** The bytes the copy would write, Type 2 TLV overhead included. */
function tlvBytes(message: CopyMessage): number {
  const bytes = messageBytes(message);
  return bytes + (bytes < 255 ? 3 : 5);
}

describe("the source-removal guard", () => {
  it("proceeds only once nothing is latched in the field", () => {
    const decision = copyDecision({ step: "source-removed", source: source(), field: { latched: null } });

    expect(decision).toEqual({ kind: "proceed", fit: null });
  });

  it("refuses while the source Tag is still in the field, and names it", () => {
    const decision = copyDecision({
      step: "source-removed",
      source: source(),
      field: latched(SOURCE_UID),
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("source-not-removed");
    expect(decision.refusal.message).toContain("source tag");
    expect(decision.refusal.detail).toContain(SOURCE_UID);
  });

  it("refuses when another Tag is in the write position, because removal was not observed", () => {
    const decision = copyDecision({
      step: "source-removed",
      source: source(),
      field: latched(DESTINATION_UID),
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("source-not-removed");
    expect(decision.refusal.message).toContain("a tag is latched");
  });

  it("refuses when a Tag is latched and its reply could not be decoded", () => {
    const decision = copyDecision({
      step: "source-removed",
      source: source(),
      field: latched(null),
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("source-not-removed");
    expect(decision.refusal.detail).toContain("could not be decoded");
  });
});

describe("the \"no tag latched\" observation", () => {
  it("takes an empty field from a poll that latched nothing", () => {
    // No reply at all, and the reply's own validity flag clear, are the same
    // observation: nothing is in the field.
    expect(observeField(null)).toEqual({ latched: null });
    expect(observeField(decodeHfPayload(Array.from({ length: 19 }, () => 0x00)))).toEqual({
      latched: null,
    });
  });

  it("refuses to read a Tag that answered but would not decode as an empty field", () => {
    // Something is there. The removal step must not be satisfied by a reply it
    // could not understand, because the source might be exactly that Tag.
    const reading = decodeHfPayload([0x01, 0x02, 0x03]);

    expect(reading.state).toBe("raw");
    expect(observeField(reading)).toEqual({ latched: { uid: null } });
  });

  it("names the Tag that is latched when its reply decodes", () => {
    expect(observeField(decodeHfPayload(cardPayload(SOURCE_UID).payload))).toEqual({
      latched: { uid: SOURCE_UID },
    });
  });
});

describe("the destination guard", () => {
  it("reports a missing destination plainly, without calling it a refusal", () => {
    const decision = copyDecision({
      step: "destination",
      source: source(),
      destination: {
        uid: null,
        latched: false,
        holds: "nothing-latched",
        message: null,
        problem: null,
        capacityBytes: null,
      },
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("nothing-latched");
    if (decision.kind !== "nothing-latched") throw new Error("expected nothing latched");
    expect(decision.message).toContain("No tag in the field");
    // The source message is still held and nothing was written to anything.
    expect(decision.detail).toContain("still held");
  });

  it("refuses a destination whose message could not be read, quoting the reason", () => {
    const decision = copyDecision({
      step: "destination",
      source: source(),
      destination: destination({
        message: null,
        problem: "the memory read did not complete",
      }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("destination-unreadable");
    expect(decision.refusal.message).toContain("could not be read");
    expect(decision.refusal.detail).toContain("the memory read did not complete");
  });

  it("refuses a destination whose poll reply could not be decoded", () => {
    const decision = copyDecision({
      step: "destination",
      source: source(),
      destination: destination({
        uid: null,
        message: null,
        problem: "the poll reply was not decoded",
      }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("destination-unreadable");
  });

  // A destination that answered every command and simply holds nothing is the
  // ordinary destination for a Copy — the second tag a copy is being put on. It
  // is not a read failure, and the guard must not refuse it as one.
  it.each(["empty-message", "no-ndef-tlv"] as const)(
    "proceeds onto a destination that read fine and holds no message (%s)",
    (holds) => {
      const held = source();
      const decision = copyDecision({
        step: "destination",
        source: held,
        destination: destination({
          message: null,
          holds,
          problem: "The tag is NDEF formatted and holds an empty message (an NDEF TLV of length zero), so it has zero Records and there is nothing to load.",
        }),
        acknowledgedUnknownFit: false,
      });

      // Zero Records to be replaced, and the capacity is still weighed.
      expect(decision).toEqual({
        kind: "proceed",
        fit: { kind: "known", requiredBytes: tlvBytes(held), capacityBytes: 496 },
      });
    },
  );

  // The other side of the same distinction: a read that genuinely failed stays
  // a refusal, whatever the destination's own sentence says.
  it.each([
    "unreadable",
    "undecodable",
    "read-failed",
    "undecoded-reply",
    "other-tag",
    "not-ndef-capable",
  ] as const)("keeps a destination that could not be read a refusal (%s)", (holds) => {
    const decision = copyDecision({
      step: "destination",
      source: source(),
      destination: destination({
        uid: null,
        message: null,
        holds,
        problem: "the message read did not complete",
      }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("destination-unreadable");
    expect(decision.refusal.detail).toContain("the message read did not complete");
  });

  it("refuses a destination that is not NDEF formatted, naming formatting rather than a read failure", () => {
    const decision = copyDecision({
      step: "destination",
      source: source(),
      destination: destination({
        message: null,
        holds: "not-formatted",
        problem:
          "The tag is not NDEF formatted, so there is no message to read: page 3 does not hold a Type 2 Capability Container.",
      }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    // Formatting is its own answer: neither a message to replace nor a failed read.
    expect(decision.refusal.condition).toBe("destination-not-formatted");
    expect(decision.refusal.message).toContain("not NDEF formatted");
    expect(decision.refusal.message).not.toContain("could not be read");
    expect(decision.refusal.detail.toLowerCase()).toContain("format");
  });

  it("refuses an empty destination that is too small for the size, not for the emptiness", () => {
    const held = source();
    const decision = copyDecision({
      step: "destination",
      source: held,
      destination: destination({ message: null, holds: "empty-message", capacityBytes: 8 }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("message-too-large");
    expect(decision.refusal.message).toContain(`${tlvBytes(held)} bytes`);
    expect(decision.refusal.message).toContain("8 bytes");
  });

  it("asks for the acknowledgement on an empty destination whose capacity is unknown, and proceeds once it has it", () => {
    const held = source();
    const ask = copyDecision({
      step: "destination",
      source: held,
      destination: destination({ message: null, holds: "no-ndef-tlv", capacityBytes: null }),
      acknowledgedUnknownFit: false,
    });
    const acknowledged = copyDecision({
      step: "destination",
      source: held,
      destination: destination({ message: null, holds: "no-ndef-tlv", capacityBytes: null }),
      acknowledgedUnknownFit: true,
    });

    expect(ask.kind).toBe("refused");
    if (ask.kind !== "refused") throw new Error("expected a refusal");
    expect(ask.refusal.condition).toBe("fit-unknown-unacknowledged");
    expect(acknowledged).toEqual({
      kind: "proceed",
      fit: { kind: "unknown", requiredBytes: tlvBytes(held) },
    });
  });

  it("refuses a destination that already holds the whole message, because there is nothing to copy", () => {
    const decision = copyDecision({
      step: "destination",
      source: source(),
      destination: destination({ message: copyMessage(DESTINATION_UID, SOURCE_RECORDS) }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("destination-identical");
    expect(decision.refusal.message).toContain("already holds");
  });

  it("refuses when the source Tag itself is in the write position", () => {
    const decision = copyDecision({
      step: "destination",
      source: source(),
      destination: destination({ uid: SOURCE_UID }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("source-not-removed");
    expect(decision.refusal.message).toContain("source tag");
  });

  it("refuses a message larger than the destination's capacity, naming both numbers", () => {
    const held = source();
    const required = tlvBytes(held);
    const decision = copyDecision({
      step: "destination",
      source: held,
      destination: destination({ capacityBytes: 8 }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("message-too-large");
    // Both numbers, in the refusal itself: what it needs and what it has.
    expect(decision.refusal.message).toContain(`${required} bytes`);
    expect(decision.refusal.message).toContain("8 bytes");
  });

  it("states that an undetermined fit is unknown, and does not let it pass without an acknowledgement", () => {
    const decision = copyDecision({
      step: "destination",
      source: source(),
      destination: destination({ capacityBytes: null }),
      acknowledgedUnknownFit: false,
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("fit-unknown-unacknowledged");
    expect(decision.refusal.message).toContain("unknown");
    expect(decision.refusal.message).toContain(`${tlvBytes(source())} bytes`);
    expect(decision.refusal.detail.toLowerCase()).toContain("acknowledg");
  });

  it("proceeds with an unknown fit once the user has acknowledged it", () => {
    const held = source();
    const decision = copyDecision({
      step: "destination",
      source: held,
      destination: destination({ capacityBytes: null }),
      acknowledgedUnknownFit: true,
    });

    expect(decision).toEqual({
      kind: "proceed",
      fit: { kind: "unknown", requiredBytes: tlvBytes(held) },
    });
  });

  it("proceeds with a known fit, carrying both numbers", () => {
    const held = source();
    const decision = copyDecision({
      step: "destination",
      source: held,
      destination: destination({ capacityBytes: 496 }),
      acknowledgedUnknownFit: false,
    });

    expect(decision).toEqual({
      kind: "proceed",
      fit: { kind: "known", requiredBytes: tlvBytes(held), capacityBytes: 496 },
    });
  });
});

describe("the write's whole-message comparison", () => {
  it("reports a verified copy when the read-back holds the same Records in order and the same length", () => {
    const held = source();
    const decision = copyDecision({
      step: "write",
      source: held,
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence("verified", copyMessage(DESTINATION_UID, SOURCE_RECORDS)),
    });

    expect(decision.kind).toBe("result");
    if (decision.kind !== "result") throw new Error("expected a result");
    expect(decision.verification).toBe("verified");
    expect(decision.message).toContain("same 2 Records");
  });

  it("reports success, not failure, for a destination that re-encoded an equal message", () => {
    // The same two Records stored with the whole URI instead of the abbreviation:
    // different bytes, same Records. A byte comparison would report this as a
    // failure, which is the one outcome worse than an honest unknown.
    const held = source();
    const wholeUri = messageFromWire(DESTINATION_UID, [
      textRecord("en", "hello"),
      { tnf: 0x01, type: [0x55], payload: [0x00, ...ascii("https://devgo.studio")] },
    ]);
    // Hand-built on the wire: the whole URI instead of the abbreviation.
    expect(wholeUri.messageHex).not.toBe(held.messageHex);

    const decision = copyDecision({
      step: "write",
      source: held,
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence("unverified", wholeUri),
    });

    expect(decision.kind).toBe("result");
    if (decision.kind !== "result") throw new Error("expected a result");
    expect(decision.verification).toBe("verified");
    expect(decision.detail).toContain("re-encoded");
  });

  it("refuses to claim a verification the decoded Records contradict", () => {
    // The backend byte-matched what it wrote, yet the read-back decodes to other
    // Records. Unreachable through a correct backend, and still not a "verified":
    // the honest answer is that this build cannot confirm it.
    const decision = copyDecision({
      step: "write",
      source: source(),
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence(
        "verified",
        copyMessage(DESTINATION_UID, [{ kind: "url", fields: { url: "https://example.com" } }]),
      ),
    });

    expect(decision.kind).toBe("result");
    if (decision.kind !== "result") throw new Error("expected a result");
    expect(decision.verification).toBe("unverified");
  });

  it("reports an unverified copy when the read-back holds different Records", () => {
    const decision = copyDecision({
      step: "write",
      source: source(),
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence(
        "unverified",
        copyMessage(DESTINATION_UID, [{ kind: "url", fields: { url: "https://example.com" } }]),
      ),
    });

    expect(decision.kind).toBe("result");
    if (decision.kind !== "result") throw new Error("expected a result");
    expect(decision.verification).toBe("unverified");
    expect(decision.message).toContain("did not read back");
  });

  it("reports an unverified copy when the write was sent and nothing read back", () => {
    const decision = copyDecision({
      step: "write",
      source: source(),
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence("unverified", null),
    });

    expect(decision.kind).toBe("result");
    if (decision.kind !== "result") throw new Error("expected a result");
    expect(decision.verification).toBe("unverified");
    expect(decision.message).toContain("could not be read back");
  });

  it("reports the merged protected condition when a readable destination would not take the write", () => {
    const previous = copyMessage(DESTINATION_UID, OTHER_RECORDS);
    const decision = copyDecision({
      step: "write",
      source: source(),
      previous,
      // Sent, and the destination still reads back exactly what it held before.
      evidence: evidence("unverified", previous),
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("destination-protected");
    expect(decision.refusal.message).toContain("read-only or password protected");
    expect(decision.refusal.message).toContain("cannot tell");
    expect(decision.refusal.detail).toContain("unchanged");
  });

  it("names the backend's own reason when the write was refused before it was sent", () => {
    const decision = copyDecision({
      step: "write",
      source: source(),
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence("refused", null, "the Tag's capacity could not be read"),
    });

    expect(decision.kind).toBe("refused");
    if (decision.kind !== "refused") throw new Error("expected a refusal");
    expect(decision.refusal.condition).toBe("destination-refused");
    expect(decision.refusal.message).toContain("the Tag's capacity could not be read");
    expect(decision.refusal.detail).toContain("Nothing was written");
  });

  it("reports a failure, not a refusal, when the write never reached the device", () => {
    const decision = copyDecision({
      step: "write",
      source: source(),
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence("failed", null, "the write could not be sent: I/O error"),
    });

    expect(decision.kind).toBe("failed");
    if (decision.kind !== "failed") throw new Error("expected a failure");
    expect(decision.message).toContain("could not be sent");
    expect(decision.detail).toContain("I/O error");
  });
});

describe("the source read the flow holds", () => {
  it("holds the message, the Records and the Tag they came from", () => {
    const read = assembleHfRead(decodeHfPayload(cardPayload(SOURCE_UID).payload), {
      state: "read",
      read: recordsReadFor(SOURCE_UID, SOURCE_RECORDS),
    });

    const held = copySource(read);

    expect(held?.uid).toBe(SOURCE_UID);
    expect(held?.records).toEqual(SOURCE_RECORDS);
    expect(held?.messageHex).toBe(bytesToHex(encodeRecords(SOURCE_RECORDS)));
  });

  it("holds nothing from a read that did not produce a message", () => {
    // A Tag that latched, whose reply could not be decoded: there is nothing to
    // copy, and a partly-read source must never become one.
    const raw = assembleHfRead(decodeHfPayload([0x01, 0x02, 0x03]), { state: "not-attempted" });
    expect(copySource(raw)).toBeNull();

    const failed = assembleHfRead(decodeHfPayload(cardPayload(SOURCE_UID).payload), {
      state: "failed",
      reason: "the memory read did not complete",
    });
    expect(failed.message.state).toBe("read-failed");
    expect(copySource(failed)).toBeNull();
  });
});

describe("weighing the message", () => {
  it("counts the Type 2 TLV overhead the write path counts", () => {
    const held = source();
    const message = messageBytes(held);

    expect(requiredBytes(held)).toBe(message + 3);
    expect(requiredBytes(held)).toBeGreaterThan(message);
  });

  it("sizes a long message with the long TLV length field", () => {
    const long = copyMessage(DESTINATION_UID, [
      { kind: "text", fields: { language: "en", text: "x".repeat(300) } },
    ]);

    expect(messageBytes(long)).toBeGreaterThan(255);
    expect(requiredBytes(long)).toBe(messageBytes(long) + 5);
  });
});

describe("the comparison itself", () => {
  it("compares the decoded Records in order, not the bytes", () => {
    const held = source();
    const reversed = copyMessage(DESTINATION_UID, [...SOURCE_RECORDS].reverse());

    const comparison = compareMessages(held, reversed);

    expect(comparison.sameRecords).toBe(false);
    expect(comparison.equal).toBe(false);
    // Both sides hold two Records of the same total size; the order is what
    // differs, so a length-only comparison would have said they were equal.
    expect(comparison.sourceBytes).toBe(comparison.readbackBytes);
  });

  it("reports the total encoded length of each side's decoded Records", () => {
    const held = source();
    const comparison = compareMessages(held, copyMessage(DESTINATION_UID, SOURCE_RECORDS));

    expect(comparison.equal).toBe(true);
    expect(comparison.sourceBytes).toBe(messageBytes(held));
    expect(comparison.readbackBytes).toBe(messageBytes(held));
  });

  it("counts a different number of Records as different, whatever the length says", () => {
    const held = source();
    const comparison = compareMessages(held, copyMessage(DESTINATION_UID, [SOURCE_RECORDS[0]!]));

    expect(comparison.sameRecords).toBe(false);
    expect(comparison.equal).toBe(false);
  });
});

describe("the audible symbol", () => {
  it("sounds done for a verified copy, needs-you for an unverified one, and attention for a refusal", () => {
    const held = source();
    const verified = copyDecision({
      step: "write",
      source: held,
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence("verified", copyMessage(DESTINATION_UID, SOURCE_RECORDS)),
    });
    const unverified = copyDecision({
      step: "write",
      source: held,
      previous: copyMessage(DESTINATION_UID, OTHER_RECORDS),
      evidence: evidence("unverified", null),
    });
    const refused = copyDecision({
      step: "destination",
      source: held,
      destination: destination({ capacityBytes: 8 }),
      acknowledgedUnknownFit: false,
    });

    expect(symbolOf(verified)).toBe("done");
    expect(symbolOf(unverified)).toBe("needs-you");
    expect(symbolOf(refused)).toBe("attention");
  });
});

describe("reading the flow's own values", () => {
  it("takes a destination from the read model, capacity included", () => {
    const read = assembleHfRead(decodeHfPayload(cardPayload(DESTINATION_UID).payload), {
      state: "read",
      read: recordsReadFor(DESTINATION_UID, OTHER_RECORDS),
    });

    const destination = copyDestination(read);

    expect(destination.latched).toBe(true);
    expect(destination.uid).toBe(DESTINATION_UID);
    expect(destination.holds).toBe("records");
    expect(destination.message?.records).toEqual(OTHER_RECORDS);
    expect(destination.capacityBytes).toBe(496);
  });

  it("takes no destination from a read that latched nothing", () => {
    const destination = copyDestination(assembleHfRead(null, { state: "not-attempted" }));

    // `holds` is the read's own state for an empty field, so the whole value is
    // still asserted: nothing latched, no message, no reason, no capacity.
    expect(destination).toEqual({
      uid: null,
      latched: false,
      holds: "nothing-latched",
      message: null,
      problem: null,
      capacityBytes: null,
    });
  });

  it("takes 'holds nothing' from the read model rather than calling an empty Tag unreadable", () => {
    const read = assembleHfRead(decodeHfPayload(cardPayload(DESTINATION_UID).payload), {
      state: "read",
      read: noMessageReadFor(DESTINATION_UID, "empty"),
    });
    const destination = copyDestination(read);

    // The read said the Tag is NDEF formatted with an empty message. That is a
    // complete read, and it is carried across rather than re-derived here.
    expect(destination.holds).toBe("empty-message");
    expect(destination.message).toBeNull();
    // So the guard may offer the copy: zero Records to be replaced.
    expect(
      copyDecision({
        step: "destination",
        source: source(),
        destination,
        acknowledgedUnknownFit: false,
      }),
    ).toEqual({
      kind: "proceed",
      fit: { kind: "known", requiredBytes: tlvBytes(source()), capacityBytes: 496 },
    });
  });

  it("takes a Tag with no NDEF TLV as holds-nothing too, not as a failed read", () => {
    const read = assembleHfRead(decodeHfPayload(cardPayload(DESTINATION_UID).payload), {
      state: "read",
      read: noMessageReadFor(DESTINATION_UID, "missing"),
    });

    expect(copyDestination(read).holds).toBe("no-ndef-tlv");
    expect(
      copyDecision({
        step: "destination",
        source: source(),
        destination: copyDestination(read),
        acknowledgedUnknownFit: false,
      }).kind,
    ).toBe("proceed");
  });

  it("keeps a Tag that is not NDEF formatted a distinct refusal, and a failed read a refusal", () => {
    const unformatted = copyDestination(
      assembleHfRead(decodeHfPayload(cardPayload(DESTINATION_UID).payload), {
        state: "read",
        read: noMessageReadFor(DESTINATION_UID, "notFormatted"),
      }),
    );
    const unreadable = copyDestination(
      assembleHfRead(decodeHfPayload(cardPayload(DESTINATION_UID).payload), {
        state: "read",
        read: noMessageReadFor(DESTINATION_UID, "unreadable"),
      }),
    );

    expect(unformatted.holds).toBe("not-formatted");
    expect(unreadable.holds).toBe("unreadable");

    const unformattedDecision = copyDecision({
      step: "destination",
      source: source(),
      destination: unformatted,
      acknowledgedUnknownFit: false,
    });
    const unreadableDecision = copyDecision({
      step: "destination",
      source: source(),
      destination: unreadable,
      acknowledgedUnknownFit: false,
    });

    if (unformattedDecision.kind !== "refused") throw new Error("expected a refusal");
    if (unreadableDecision.kind !== "refused") throw new Error("expected a refusal");
    expect(unformattedDecision.refusal.condition).toBe("destination-not-formatted");
    expect(unreadableDecision.refusal.condition).toBe("destination-unreadable");
  });

  it("takes the read-back message from the write's own result", () => {
    const result: NdefWriteResult = {
      outcome: "verified",
      message: null,
      before: null,
      after: tagSnapshot(DESTINATION_UID, SOURCE_RECORDS),
      capacityBytes: 496,
      requiredBytes: 1,
      wrotePages: [4],
      acceptedPages: [4],
    };

    const write = copyEvidence(result);

    expect(write.outcome).toBe("verified");
    expect(write.readback?.uid).toBe(DESTINATION_UID);
    expect(write.readback?.records).toEqual(SOURCE_RECORDS);
  });

  it("says a write it cannot read back has no read-back message rather than inventing one", () => {
    const result: NdefWriteResult = {
      outcome: "unverified",
      message: null,
      before: null,
      after: null,
      capacityBytes: 496,
      requiredBytes: 1,
      wrotePages: [4],
      acceptedPages: [],
    };

    expect(copyEvidence(result).readback).toBeNull();
  });

  it("reports a decision it cannot act on as no outcome at all", () => {
    // A proceed is a step, not a result: nothing happened, so nothing is sounded.
    expect(copyOutcome({ kind: "proceed", fit: null })).toBeNull();
  });
});

/** A decision rendered as its symbol, for the test written above. */
function symbolOf(decision: CopyDecision): string {
  const outcome = copyOutcome(decision);
  if (outcome === null) throw new Error("a result, a refusal or a failure was expected");
  return signalOf(outcome);
}

/** A Tag is latched, and its reply decoded (or not, when `uid` is null). */
function latched(uid: string | null): CopyFieldObservation {
  return { latched: { uid } };
}

/**
 * A message as a Tag returned it: the wire bytes, plus the Records they decode
 * to. Deliberately not re-encoded — the point of these fixtures is that the bytes
 * on the wire and the Records they mean are two different things.
 */
function messageFromWire(uid: string, records: NdefRecord[]): CopyMessage {
  return {
    uid,
    records: decodeRecords(encodeNdefMessage(records)),
    messageHex: bytesToHex(encodeNdefMessage(records)),
  };
}

/** Printable ASCII as bytes, for a hand-built wire Record. */
function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

/** An NTAG215-ish poll payload: a 7-byte UID, ATQA 00 44, SAK 00, two cascades. */
function cardPayload(uid: string): HfCard {
  const bytes = uid.split(" ").map((part) => Number.parseInt(part, 16));
  const buffer = [...bytes, ...Array.from({ length: 10 - bytes.length }, () => 0)];
  return {
    payload: [0x01, 0x01, ...buffer, bytes.length, 0x44, 0x00, 0x00, 0x02, 0x00, 0x00],
  };
}

/** What `ntag_records_read` answers for one Tag. */
function recordsReadFor(uid: string, records: readonly DraftRecord[]) {
  const messageHex = bytesToHex(encodeRecords(records));
  return {
    dump: dump(uid),
    ndef: {
      outcome: "message" as const,
      messageHex,
      messageBytes: messageHex.split(" ").length,
      userMemoryHex: "03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE",
      userMemoryBytes: 496,
      capacityBytes: 496,
      userPages: 124,
      capabilityContainerHex: "E1 10 3E 00",
      reason: null,
    },
  };
}

/** What `ntag_records_read` answers for a Tag with nothing to read, by outcome. */
function noMessageReadFor(
  uid: string,
  outcome: "empty" | "missing" | "notFormatted" | "unreadable",
): TagRecordsRead {
  const reason =
    outcome === "empty"
      ? "the tag is NDEF formatted and its NDEF TLV is empty (03 00), so it holds no message"
      : outcome === "missing"
        ? "the tag is NDEF formatted but its user memory holds no 0x03 NDEF TLV, so it holds no message"
        : outcome === "notFormatted"
          ? "the tag is not NDEF formatted: page 3 is not a Type 2 Capability Container"
          : "the NDEF TLV does not parse";
  return {
    dump: dump(uid),
    ndef: {
      outcome,
      messageHex: "",
      messageBytes: 0,
      userMemoryHex: "03 00 FE",
      userMemoryBytes: 496,
      capacityBytes: outcome === "notFormatted" ? null : 496,
      userPages: 124,
      capabilityContainerHex: outcome === "notFormatted" ? "00 00 00 00" : "E1 10 3E 00",
      reason,
    },
  };
}

/** One Tag as a write result carries it. */
function tagSnapshot(uid: string, records: readonly DraftRecord[]): NdefTagSnapshot {
  const messageHex = bytesToHex(encodeRecords(records));
  return {
    uid,
    reportedTagType: 0x02,
    capacityBytes: 496,
    userPages: 124,
    existing: {
      state: "message",
      messageHex,
      bytes: messageHex.split(" ").length,
      reason: null,
    },
  };
}
