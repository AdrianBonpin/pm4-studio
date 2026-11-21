import { describe, expect, it } from "vitest";
import {
  CONFIRMED_COPIES_HINT,
  confirmedCopiesLabel,
  countsAsConfirmedCopy,
  writeNotice,
} from "./writeOutcome";
import type { WriteOutcome } from "../types";
import type { WriteResult } from "../types";

// Only one of the four outcomes is evidence that another Tag carries an
// Identity. These expectations are the counting rule the Rust store implements,
// stated again where the UI reads it, so a change to either side fails a test.

const CARD = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 132,
  card: 33298,
  raw: "00 01 01 00",
};

function result(outcome: WriteOutcome, overrides: Partial<WriteResult> = {}): WriteResult {
  return {
    customer: CARD.customer,
    data32: CARD.data32,
    readback: outcome === "verified" ? CARD : null,
    outcome,
    verified: outcome === "verified",
    message: null,
    confirmedCopies: outcome === "verified" ? 1 : 0,
    countProblem: null,
    ...overrides,
  };
}

describe("countsAsConfirmedCopy", () => {
  it("counts only a verified write", () => {
    expect(countsAsConfirmedCopy("verified")).toBe(true);
  });

  it("never counts a refusal, an unknown result, or a transmission failure", () => {
    expect(countsAsConfirmedCopy("refused")).toBe(false);
    expect(countsAsConfirmedCopy("unverified")).toBe(false);
    expect(countsAsConfirmedCopy("failed")).toBe(false);
  });
});

describe("confirmedCopiesLabel", () => {
  it("says there are none, rather than showing a bare zero", () => {
    expect(confirmedCopiesLabel(0)).toBe("No confirmed copies");
  });

  it("uses the singular for one copy", () => {
    expect(confirmedCopiesLabel(1)).toBe("1 confirmed copy");
  });

  it("counts copies, not attempts", () => {
    const label = confirmedCopiesLabel(3);
    expect(label).toBe("3 confirmed copies");
    expect(label).not.toMatch(/attempt|tried|writes|written/i);
  });

  it("never shows a negative count", () => {
    expect(confirmedCopiesLabel(-1)).toBe("No confirmed copies");
  });
});

describe("writeNotice", () => {
  it("reports a verified write as confirmed, with the count of copies", () => {
    const notice = writeNotice(result("verified", { confirmedCopies: 3 }));
    expect(notice.tone).toBe("ok");
    expect(notice.text).toContain("55 00 84 82 12");
    expect(notice.text).toContain("3 confirmed copies");
  });

  it("reports a refusal as not written, with the guard's reason", () => {
    const notice = writeNotice(
      result("refused", {
        message: "the tag on the reader already reads as 55 00 84 82 12",
        confirmedCopies: 2,
      }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("already reads as");
    expect(notice.text).toContain("2 confirmed copies");
    expect(notice.text).not.toContain("now reads");
  });

  it("reports an unconfirmed read-back as unknown, and says nothing was counted", () => {
    const notice = writeNotice(result("unverified", { confirmedCopies: 1 }));
    expect(notice.tone).toBe("warn");
    expect(notice.text).toContain("Unknown");
    expect(notice.text).toContain("not counted");
    expect(notice.text).toContain("1 confirmed copy");
  });

  it("reports a transmission failure as nothing written, and nothing counted", () => {
    const notice = writeNotice(
      result("failed", { message: "the device is unplugged", confirmedCopies: 0 }),
    );
    expect(notice.tone).toBe("err");
    expect(notice.text).toContain("could not be sent");
    expect(notice.text).toContain("the device is unplugged");
    expect(notice.text).toContain("No confirmed copies");
  });

  it("says when the library holds no Snapshot for the Identity at all", () => {
    const verified = writeNotice(result("verified", { confirmedCopies: null }));
    expect(verified.tone).toBe("ok");
    expect(verified.text).not.toContain("confirmed copies");
    expect(verified.text).toContain("No Snapshot");

    const refused = writeNotice(result("refused", { confirmedCopies: null }));
    expect(refused.text).toContain("No Snapshot");
  });

  it("never claims a copy for any outcome other than verified", () => {
    const others: WriteOutcome[] = ["refused", "unverified", "failed"];
    for (const outcome of others) {
      const notice = writeNotice(result(outcome, { confirmedCopies: 0 }));
      expect(notice.tone).not.toBe("ok");
      expect(notice.text).not.toMatch(/now reads|Cloned and verified/);
    }
  });
});

describe("CONFIRMED_COPIES_HINT", () => {
  it("states which writes count, without softening it", () => {
    expect(CONFIRMED_COPIES_HINT).toContain("read-back");
    expect(CONFIRMED_COPIES_HINT).toMatch(/refused/i);
    expect(CONFIRMED_COPIES_HINT).toMatch(/unverified/i);
    expect(CONFIRMED_COPIES_HINT).toMatch(/failed/i);
  });
});
