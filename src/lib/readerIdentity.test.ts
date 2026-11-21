import { describe, expect, it } from "vitest";
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
});
