import { describe, expect, it } from "vitest";
import {
  DRAFT_NOT_A_TAG_NOTICE,
  EMPTY_DRAFTS_DETAIL,
  EMPTY_DRAFT_DETAIL,
  draftDetail,
  draftTitle,
  formatUpdatedAt,
  newTextRecord,
  newUrlRecord,
  recordKindLabel,
  recordSummary,
} from "./drafts";
import type { Draft } from "./drafts";

/**
 * The Drafts page copy and formatting. A Draft is an editable NDEF message that
 * belongs to no Tag, so the words matter as much as the numbers: an empty Draft
 * has to explain what it is for, and nothing may imply a Draft is a Tag.
 */

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  id: "draft-1",
  name: "Front door",
  updatedAt: "2026-11-21T11:05:00.000Z",
  records: [],
  ...overrides,
});

describe("an empty Draft explains what it is for", () => {
  it("says what a Record is and that nothing is attached to a Tag", () => {
    expect(EMPTY_DRAFT_DETAIL).toMatch(/Record/);
    expect(EMPTY_DRAFT_DETAIL).toMatch(/no Tag|belongs to no Tag/i);
  });

  it("explains a Draft before one exists, without calling it a Tag", () => {
    expect(EMPTY_DRAFTS_DETAIL).toMatch(/NDEF message/);
    expect(EMPTY_DRAFTS_DETAIL).toMatch(/no Tag attached/i);
    expect(DRAFT_NOT_A_TAG_NOTICE).toMatch(/not attached to any Tag/);
  });

  it("never uses the words the glossary retires", () => {
    for (const copy of [EMPTY_DRAFTS_DETAIL, EMPTY_DRAFT_DETAIL, DRAFT_NOT_A_TAG_NOTICE]) {
      expect(copy.toLowerCase()).not.toMatch(/\bbadge\b|\bfob\b/);
    }
  });
});

describe("how a Draft reads in the list", () => {
  it("shows the name, or the id when the name is blank", () => {
    expect(draftTitle(draft())).toBe("Front door");
    expect(draftTitle(draft({ name: "   " }))).toBe("draft-1");
  });

  it("counts Records and encoded bytes, in that order", () => {
    const empty = draft();
    expect(draftDetail(empty, Date.parse(empty.updatedAt) + 1000)).toBe("0 Records · 0 bytes · just now");

    const two = draft({
      records: [
        newTextRecord("en", "Hello"),
        newUrlRecord("https://example.com/x"),
      ],
    });
    // 12 bytes for the Text Record and 18 for the URL Record, from ndef.test.ts.
    expect(draftDetail(two, Date.parse(two.updatedAt) + 1000)).toBe(
      "2 Records · 30 bytes · just now",
    );
  });

  it("says one Record, not 1 Records", () => {
    const one = draft({ records: [newTextRecord("en", "Hi")] });
    expect(draftDetail(one, Date.parse(one.updatedAt) + 1000)).toMatch(/^1 Record · /);
  });

  it("describes a Record by its kind and by what the user typed", () => {
    expect(recordKindLabel(newTextRecord("en", "Hello"))).toBe("Text");
    expect(recordKindLabel(newUrlRecord("https://example.com"))).toBe("URL");
    expect(recordSummary(newTextRecord("en", "Hello"))).toBe("Hello");
    expect(recordSummary(newUrlRecord("https://example.com"))).toBe("https://example.com");
  });

  it("labels an unparseable timestamp with nothing rather than a wrong time", () => {
    expect(formatUpdatedAt("not a date")).toBe("");
  });
});
