import { describe, expect, it } from "vitest";
import {
  ERASE_ACTION_LABEL,
  ERASE_IS_NOT_PASSWORD_REMOVAL,
  ERASE_IS_NOT_READ_ONLY,
  eraseConfirmation,
  eraseNotice,
  eraseSentence,
  eraseWhere,
  erasedPagesLabel,
  type NdefErasePreview,
} from "./eraseTag";
import { draftMessageHex, type ExistingNdef, type NdefTagView } from "./tagWrite";
import type { EraseResult } from "../types";

/**
 * The message recorded in docs/PROTOCOL.md on the spike's NTAG215:
 * `03 11 D1 01 0D 55 04 "devgo.studio" FE`, a URL Record behind a 0x11-byte
 * message. Every expectation below is checked against these real bytes rather
 * than against bytes this module invented.
 */
const RECORDED_MESSAGE_HEX = "D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F";

/** The 9 bytes of the message ticket 18's probe wrote (`03 09 <these> FE`).
 *  They are not a well-formed NDEF Text record — the probe put the type byte
 *  where the payload length belongs — so the codec must refuse to name it. */
const TICKET_18_PROBE_MESSAGE_HEX = "D1 01 54 05 02 65 6E 68 69";

/** Two Records this build can encode and decode: a URL then a Text. */
const TWO_RECORDS_HEX = draftMessageHex([
  { kind: "url", fields: { url: "https://devgo.studio" } },
  { kind: "text", fields: { language: "en", text: "hi" } },
]);

const RECORDED_UID = "04 43 8A 01 22 09 03";

function tag(existing: ExistingNdef): NdefTagView {
  return {
    uid: RECORDED_UID,
    reportedTagType: 5,
    capacityBytes: 496,
    userPages: 124,
    existing,
  };
}

const MESSAGE: ExistingNdef = {
  state: "message",
  messageHex: RECORDED_MESSAGE_HEX,
  bytes: 17,
  reason: null,
};

const EMPTY: ExistingNdef = { state: "empty", messageHex: null, bytes: 0, reason: null };

function preview(overrides: Partial<NdefErasePreview> = {}): NdefErasePreview {
  return {
    tag: tag(MESSAGE),
    clearsBytes: 20,
    pages: [4, 5, 6, 7, 8],
    capacityBytes: 496,
    canErase: true,
    refusal: null,
    ...overrides,
  };
}

function result(overrides: Partial<EraseResult> = {}): EraseResult {
  return {
    outcome: "erased",
    message: null,
    before: tag(MESSAGE),
    after: tag(EMPTY),
    capacityBytes: 496,
    clearedBytes: 20,
    erasePages: [4, 5, 6, 7, 8],
    acceptedPages: [4, 5, 6, 7, 8],
    identityIntact: true,
    writtenHex: "03 00 FE 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ...overrides,
  };
}

describe("naming what an erase will lose", () => {
  it("names the Record the tag holds now, not just 'the tag'", () => {
    const sentence = eraseSentence(preview());
    expect(sentence).toContain("https://devgo.studio");
    expect(sentence).toContain("1 Record");
  });

  it("names a multi-Record message by its first Record and count", () => {
    const sentence = eraseSentence(
      preview({ tag: tag({ ...MESSAGE, messageHex: TWO_RECORDS_HEX, bytes: 41 }) }),
    );
    expect(sentence).toContain("2 Records, starting with");
    expect(sentence).toContain("https://devgo.studio");
  });

  it("names the bytes of a message it cannot decode rather than inventing Records", () => {
    // Ticket 18's recorded probe bytes are 9 bytes and are not a valid Text
    // record, so the confirmation says the size and admits it cannot name them.
    const sentence = eraseSentence(
      preview({
        tag: tag({
          state: "message",
          messageHex: TICKET_18_PROBE_MESSAGE_HEX,
          bytes: 9,
          reason: null,
        }),
      }),
    );
    expect(sentence).toContain("cannot decode");
    expect(sentence).toContain("9 bytes");
  });

  it("says the tag already holds nothing rather than offering a pointless write", () => {
    const sentence = eraseSentence(preview({ tag: tag(EMPTY), clearsBytes: 0, pages: [] }));
    expect(sentence).toContain("nothing to erase");
  });

  it("says content it could not read may not be listed in full", () => {
    const unreadable: ExistingNdef = {
      state: "unreadable",
      messageHex: null,
      bytes: 0,
      reason: "a TLV declares 512 bytes and only 496 remain",
    };
    const sentence = eraseSentence(preview({ tag: tag(unreadable) }));
    expect(sentence).toContain("could not read");
    expect(sentence).toContain("only 496 remain");
  });

  it("says a message it cannot decode is being cleared, with its size", () => {
    const unknown: ExistingNdef = { state: "message", messageHex: "80 01 00", bytes: 3, reason: null };
    const sentence = eraseSentence(preview({ tag: tag(unknown) }));
    expect(sentence).toContain("cannot decode");
    expect(sentence).toContain("3 bytes");
  });

  it("passes a refusal through when there is no tag to name", () => {
    const refused = preview({
      tag: null,
      canErase: false,
      refusal: "no 13.56 MHz Tag is in the field, so there is nothing to erase",
    });
    expect(eraseSentence(refused)).toBe(
      "no 13.56 MHz Tag is in the field, so there is nothing to erase",
    );
  });

  it("states where the write lands in pages", () => {
    expect(eraseWhere(preview())).toContain("pages 4–8 (5 pages)");
    expect(eraseWhere(preview({ clearsBytes: 0, pages: [] }))).toBe("Nothing to write.");
  });
});

describe("the confirmation", () => {
  it("names the tag and the Records that would be lost", () => {
    const confirmation = eraseConfirmation(preview());
    expect(confirmation.title).toContain(RECORDED_UID);
    expect(confirmation.title).toContain("Erase");
    expect(confirmation.sentence).toContain("https://devgo.studio");
    expect(confirmation.action).toBe(ERASE_ACTION_LABEL);
    expect(confirmation.facts.length).toBeGreaterThan(0);
  });

  it("says the tag stays a tag: content is cleared, the format is not changed", () => {
    const confirmation = eraseConfirmation(preview());
    const facts = confirmation.facts.map((fact) => `${fact.title} ${fact.detail}`).join(" ");
    expect(facts).toContain("The tag stays a tag");
    expect(facts).toContain("does not destroy the tag or change its format");
    expect(facts).toContain("Pages 0 to 3");
    // No fact may claim the tag cannot be written afterwards.
    expect(facts).not.toContain("read-only");
  });

  it("says plainly that erasing is not a way to make a tag read-only", () => {
    const confirmation = eraseConfirmation(preview());
    expect(confirmation.notReadOnly).toBe(ERASE_IS_NOT_READ_ONLY);
    expect(confirmation.notReadOnly).toContain("does not make this tag read-only");
    expect(confirmation.notReadOnly).toContain("can be written again");
  });

  it("says plainly that erasing does not remove password protection", () => {
    const confirmation = eraseConfirmation(preview());
    expect(confirmation.notPasswordRemoval).toBe(ERASE_IS_NOT_PASSWORD_REMOVAL);
    expect(confirmation.notPasswordRemoval).toContain("does not remove password protection");
    expect(confirmation.notPasswordRemoval).toContain("unrecoverable");
  });

  it("is built from what was read, so it cannot describe an unread tag", () => {
    const confirmation = eraseConfirmation(
      preview({
        tag: null,
        canErase: false,
        refusal: "no 13.56 MHz Tag is in the field, so there is nothing to erase",
      }),
    );
    expect(confirmation.uid).toBe("no tag");
    expect(confirmation.sentence).toContain("nothing to erase");
  });
});

describe("the outcome wording", () => {
  it("reports a successful erase as 'erased', never as 'verified'", () => {
    const notice = eraseNotice(result());
    expect(notice.tone).toBe("ok");
    expect(notice.text).toContain("Erased");
    expect(notice.text).not.toContain("Verified");
  });

  it("says the tag is present with no Records and stays usable", () => {
    const notice = eraseNotice(result());
    expect(notice.text).toContain("present with no Records");
    expect(notice.text).toContain("unchanged");
    expect(notice.text).toContain("written again");
  });

  it("states that clearing content moves no confirmed-copy count", () => {
    expect(eraseNotice(result()).text).toContain("confirmed-copy count moved");
  });

  it("says how much content it cleared", () => {
    expect(eraseNotice(result()).text).toContain("cleared 20 bytes");
    expect(eraseNotice(result({ clearedBytes: 1 })).text).toContain("cleared 1 byte");
  });

  it("reports a refusal as refused, with the reason", () => {
    const notice = eraseNotice(
      result({
        outcome: "refused",
        message: "the Tag could not be read, so nothing was erased: no tag latched",
        after: null,
        acceptedPages: [],
        identityIntact: null,
      }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("Not erased");
    expect(notice.text).toContain("could not be read");
  });

  it("reports a failed erase as failure and says the tag is still readable", () => {
    const notice = eraseNotice(
      result({
        outcome: "failed",
        message: "the tag still reads back with an NDEF message, so the erase did not take.",
        after: tag(MESSAGE),
      }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("still readable");
    expect(notice.text).toContain("still reads back with an NDEF message");
  });

  it("does not claim a tag it never read back is still readable", () => {
    const notice = eraseNotice(
      result({
        outcome: "failed",
        message: "the erase could not be sent: USB write failed",
        after: null,
        acceptedPages: [],
        identityIntact: null,
      }),
    );
    expect(notice.text).toContain("could not be sent");
    expect(notice.text).not.toContain("still readable");
  });

  it("reports an unreadable read-back as unknown, not as success or failure", () => {
    const notice = eraseNotice(
      result({ outcome: "unverified", after: null, identityIntact: null }),
    );
    expect(notice.tone).toBe("warn");
    expect(notice.text).toContain("Unknown");
    expect(notice.text).not.toContain("Erased —");
  });

  it("reports which pages the firmware says it wrote", () => {
    expect(erasedPagesLabel(result())).toBe("pages 4–8 (5 pages)");
    expect(erasedPagesLabel(result({ acceptedPages: [] }))).toBe("no pages");
  });
});
