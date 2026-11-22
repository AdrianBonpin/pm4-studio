import { describe, expect, it } from "vitest";
import {
  DRAFT_NOT_A_TAG_NOTICE,
  EMPTY_DRAFTS_DETAIL,
  EMPTY_DRAFT_DETAIL,
  RECORD_KINDS,
  capacityNote,
  draftDetail,
  draftTitle,
  filterDrafts,
  formatUpdatedAt,
  newBluetoothRecord,
  newContactRecord,
  newEmailRecord,
  newExternalRecord,
  newLocationRecord,
  newMimeRecord,
  newPhoneRecord,
  newRecord,
  newSmsRecord,
  newTextRecord,
  newUrlRecord,
  newWifiRecord,
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

  it("still describes a Draft whose Record cannot be encoded", () => {
    const bad = draft({ records: [newWifiRecord({ ssid: "" })] });
    const detail = draftDetail(bad, Date.parse(bad.updatedAt) + 1000);
    expect(detail).toContain("1 Record");
    expect(detail).toContain("size unavailable");
  });
});

describe("the offered Record types", () => {
  it("offers exactly the set the spec fixed, in editor order", () => {
    expect(RECORD_KINDS).toEqual([
      "text",
      "url",
      "phone",
      "email",
      "contact",
      "sms",
      "location",
      "wifi",
      "bluetooth",
      "mime",
      "external",
    ]);
  });

  it("offers nothing that is meaningless from a desktop app", () => {
    const offered = RECORD_KINDS.join(" ");
    expect(offered).not.toMatch(/android|app|social|homekit|payment|printer|3d/i);
  });

  it("creates a blank Record of every offered kind", () => {
    for (const kind of RECORD_KINDS) {
      expect(newRecord(kind).kind).toBe(kind);
    }
  });

  it("names every kind for the Record row", () => {
    expect(recordKindLabel(newTextRecord())).toBe("Text");
    expect(recordKindLabel(newUrlRecord())).toBe("URL");
    expect(recordKindLabel(newPhoneRecord())).toBe("Phone");
    expect(recordKindLabel(newEmailRecord())).toBe("Email");
    expect(recordKindLabel(newContactRecord())).toBe("Contact");
    expect(recordKindLabel(newSmsRecord())).toBe("SMS");
    expect(recordKindLabel(newLocationRecord())).toBe("Location");
    expect(recordKindLabel(newWifiRecord())).toBe("Wi-Fi");
    expect(recordKindLabel(newBluetoothRecord())).toBe("Bluetooth");
    expect(recordKindLabel(newMimeRecord())).toBe("MIME");
    expect(recordKindLabel(newExternalRecord())).toBe("External");
  });

  it("summarises every kind by the value that identifies it", () => {
    expect(recordSummary(newPhoneRecord("+15550100"))).toBe("+15550100");
    expect(recordSummary(newEmailRecord("someone@example.com"))).toBe("someone@example.com");
    expect(recordSummary(newContactRecord({ name: "Ada Lovelace" }))).toBe("Ada Lovelace");
    expect(recordSummary(newSmsRecord("+15550100", "Hello"))).toBe("+15550100: Hello");
    expect(recordSummary(newSmsRecord("+15550100"))).toBe("+15550100");
    expect(recordSummary(newLocationRecord("51.5074", "-0.1278"))).toBe("51.5074, -0.1278");
    expect(recordSummary(newWifiRecord({ ssid: "HomeNet" }))).toBe("HomeNet");
    expect(recordSummary(newBluetoothRecord("AA:BB:CC:DD:EE:FF"))).toBe("AA:BB:CC:DD:EE:FF");
    expect(recordSummary(newMimeRecord("text/plain", ""))).toBe("text/plain");
    expect(recordSummary(newExternalRecord("example.com:do", ""))).toBe("example.com:do");
  });
});

describe("size against a target", () => {
  it("compares the total where capacity is known", () => {
    expect(capacityNote(100, 144)).toBe("100 of 144 bytes, 44 left");
    expect(capacityNote(144, 144)).toBe("144 of 144 bytes, full");
    expect(capacityNote(145, 144)).toBe("145 bytes does not fit in 144");
  });

  it("states that capacity is unknown instead of guessing", () => {
    const note = capacityNote(100, null);
    expect(note).toMatch(/not known/i);
    expect(note).not.toMatch(/\d+ of \d+/);
  });
});

/**
 * The Draft Search, at the seam the spec names (S1).
 *
 * A Draft and a query in, a list out. The filter searches the Draft's own facts —
 * its name, its id, and the values authored inside its Records — through the one
 * comparison rule Snapshots already use. These tests say what a user would type,
 * not how the comparison is implemented.
 */
describe("filterDrafts", () => {
  const updatedAt = "2026-11-21T11:05:00.000Z";

  const DOOR: Draft = {
    id: "draft-door",
    name: "Front door",
    updatedAt,
    records: [newTextRecord("en", "Ring the bell")],
  };

  const GUEST: Draft = {
    id: "draft-guest",
    name: "Visitor wifi",
    updatedAt,
    records: [newWifiRecord({ ssid: "Harbour Guest", networkKey: "tidewater77" })],
  };

  const OFFICE: Draft = {
    id: "draft-office",
    name: "Site office",
    updatedAt,
    records: [
      newContactRecord({
        name: "Ada Okafor",
        organization: "Harbour Works",
        phone: "+4489012345",
        email: "ada@dockyard.example",
      }),
    ],
  };

  /** A Draft whose only Record cannot be encoded: it has no measurable size. */
  const BROKEN: Draft = {
    id: "draft-rooftop",
    name: "Rooftop camera",
    updatedAt,
    records: [newWifiRecord({ ssid: "" })],
  };

  const all = [DOOR, GUEST, OFFICE, BROKEN];

  it("keeps everything when nothing has been typed, and hands back the same array", () => {
    expect(filterDrafts(all, "")).toBe(all);
    expect(filterDrafts(all, "   ")).toBe(all);
  });

  it("matches a Draft's name, whatever the case", () => {
    expect(filterDrafts(all, "front")).toEqual([DOOR]);
    expect(filterDrafts(all, "FRONT DOOR")).toEqual([DOOR]);
  });

  it("matches a Draft's id", () => {
    expect(filterDrafts(all, "draft-office")).toEqual([OFFICE]);
    expect(filterDrafts(all, "draft-guest")).toEqual([GUEST]);
  });

  it("matches text authored inside a Record", () => {
    expect(filterDrafts(all, "ring the bell")).toEqual([DOOR]);
  });

  it("matches a URL, a phone number and an email address authored inside a Record", () => {
    const url: Draft = {
      id: "draft-1",
      name: "Workshop",
      updatedAt,
      records: [newUrlRecord("https://dockyard.example/workshop")],
    };
    const phone: Draft = {
      id: "draft-2",
      name: "Gate line",
      updatedAt,
      records: [newPhoneRecord("+4489012399")],
    };
    const email: Draft = {
      id: "draft-3",
      name: "Enquiries",
      updatedAt,
      records: [newEmailRecord("enquiries@dockyard.example")],
    };
    const drafts = [url, phone, email];

    expect(filterDrafts(drafts, "dockyard.example/workshop")).toEqual([url]);
    expect(filterDrafts(drafts, "89012399")).toEqual([phone]);
    expect(filterDrafts(drafts, "enquiries@")).toEqual([email]);
  });

  it("matches a contact's name and their organisation", () => {
    expect(filterDrafts(all, "ada okafor")).toEqual([OFFICE]);
    expect(filterDrafts(all, "harbour works")).toEqual([OFFICE]);
  });

  it("matches a Wi-Fi SSID and the network key", () => {
    expect(filterDrafts(all, "harbour guest")).toEqual([GUEST]);
    expect(filterDrafts(all, "tidewater77")).toEqual([GUEST]);
  });

  it("ignores the spacing a user types", () => {
    expect(filterDrafts(all, "harbour   works")).toEqual([OFFICE]);
    expect(filterDrafts(all, "ringthebell")).toEqual([DOOR]);
  });

  it("is empty when nothing matches", () => {
    expect(filterDrafts(all, "zzzz")).toEqual([]);
  });

  it("lists a Draft whose Record cannot be encoded, and searches it by name and id", () => {
    expect(filterDrafts(all, "")).toContain(BROKEN);
    expect(filterDrafts(all, "rooftop")).toEqual([BROKEN]);
    expect(filterDrafts(all, "draft-rooftop")).toEqual([BROKEN]);
  });

  it("hands back the very same Drafts rather than rebuilt copies, in the order given", () => {
    const filtered = filterDrafts(all, "harbour");
    expect(filtered.map((draft) => draft.id)).toEqual([GUEST.id, OFFICE.id]);
    expect(filtered[0]).toBe(GUEST);
    expect(filtered[1]).toBe(OFFICE);
  });

  it("does not reorder and does not touch the array it was given", () => {
    const original = [...all];
    filterDrafts(all, "front");
    expect(all).toEqual(original);
  });
});
