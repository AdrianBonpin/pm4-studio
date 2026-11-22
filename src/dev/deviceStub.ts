/**
 * The verification device stub: a fixture backend for the browser.
 *
 * Why this exists at all
 * ----------------------
 * The redesign is verified in a browser, and both band pages are useless without
 * a Reader: a 125 kHz page with an empty field renders a placeholder, and a
 * 13.56 MHz Read with nothing latched renders a state no one needs to see twice.
 * Layout, density, wrapping, mode switching and the two-pane Library are only
 * reviewable against a page that has something on it.
 *
 * So something stands where the webview stops and Rust begins. That boundary is
 * exactly one function — `@tauri-apps/api/core`'s `invoke` delegates to
 * `window.__TAURI_INTERNALS__.invoke` — so installing an object there means every
 * module between a control and the backend runs unmodified. Nothing app-internal
 * is mocked and no module is replaced. The same discipline the jsdom harness
 * (`src/test/dom.tsx`) already uses, moved one level out so it works in a real
 * browser with real layout.
 *
 * What it is not
 * --------------
 * This is not evidence about a Tag. It answers from values written down here;
 * nothing is read, written, armed or beeped. Every claim in
 * `docs/superpowers/e2e/` that concerns a tag, a write or a beep is marked as
 * not made. The hardware half of the verification is a separate checklist a human
 * runs with real tags (`docs/superpowers/hardware-checklist-...`).
 *
 * Nor may it ship. See `src/lib/deviceBoundary.ts` for the two-mechanism refusal:
 * this module is reachable only from `e2e.html` (never a production build input),
 * and `installDeviceStub` throws rather than installing when it is asked to run in
 * a production build. Both halves fail closed.
 *
 * How the field is controlled
 * ---------------------------
 * A real Reader's field changes because a human moves a tag. The stub cannot know
 * that, so the tag is state: the profiles below, selected with URL parameters for
 * a reproducible screenshot (`?lf=written&hf=classic`) and changed mid-flow from a
 * hidden panel (`Alt+Shift+D`) for the flows that need a swap — Clone's "take the
 * original off" and Copy's observed removal. The panel never appears on screen
 * unless asked for, because it is not part of the interface under review.
 */

import {
  DEVICE_FIXTURE_MARKER,
  renderFatalNotice,
  type BoundaryTarget,
} from "../lib/deviceBoundary";
import { decodeRecords } from "../lib/ndef";
import { hexToBytes } from "../lib/tagWrite";
import type { Draft, DraftRecord, DraftsView } from "../lib/drafts";
import type { LibraryView, Snapshot } from "../lib/library";
import type { DumpRow, MemoryDump } from "../lib/memoryDump";
import type { TagNdef, TagNdefOutcome, TagRecordsRead } from "../lib/tagRecords";
import type { DeviceInfo, HfCard, LfCard, TagOperation } from "../types";
import { mountStubPanel } from "./stubPanel";

/**
 * A string that exists in this module and nowhere else.
 *
 * It is how the absence of this module from a release bundle is proved: the
 * production build is grepped for it, and string literals survive minification,
 * so "not found" means "this file is not in the graph" rather than "this file was
 * renamed".
 */
export const STUB_MODULE_MARKER = "PM4-STUDIO-VERIFICATION-DEVICE-STUB";

/** Which Tag the 125 kHz field is holding. */
export type LfProfile = "source" | "blank" | "written" | "none";

/** Which Tag the 13.56 MHz field is holding. */
export type HfProfile = "ntag" | "ntag-empty" | "ntag-dest" | "classic" | "unknown" | "none";

/* ------------------------------------------------------------------ fixtures */

/**
 * The original: the Identity this project's own early probe wrote to a T5577.
 *
 * It is the value in the 125 kHz component tests and in the spec's account of the
 * tag that would not blank, so the screenshots and the tests show one tag rather
 * than two fixtures that happen to agree.
 */
const SOURCE: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "01 01 00 00 00 00 00 55 00 00 00 12 82 84 00 00 00 C8 42 01 00 00 00",
};

/** A Blank T5577: it carries some other Identity, which a write would destroy. */
const BLANK: LfCard = {
  customer: 0x77,
  data32: 0x00ab_cdef,
  id: "77 00 AB CD EF",
  facility: 0xab,
  card: 0xcdef,
  raw: "01 01 00 00 00 00 00 77 00 00 00 EF CD AB 00 00 00 C8 42 01 00 00 00",
};

/** The NTAG215 capture from the spec: 7-byte UID, ATQA `44 00`, SAK `00`. */
const NTAG_PAYLOAD: readonly number[] = [
  0x01, 0x01, 0x04, 0x43, 0x8a, 0x01, 0x22, 0x09, 0x03, 0x1d, 0x00, 0x20, 0x07, 0x44, 0x00, 0x00,
  0x02, 0x00, 0x00,
];

/** The MIFARE Classic 1K capture from the spec: 4-byte UID, SAK `08`. */
const CLASSIC_PAYLOAD: readonly number[] = [
  0x01, 0x01, 0x31, 0xf3, 0x0e, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x04, 0x00, 0x08,
  0x01, 0x10, 0x00,
];

/**
 * A latched Tag whose ATQA/SAK pair matches nothing published: the raw-only
 * fallback. A made-up pair rather than a real one, because a real unlisted family
 * would be a claim about hardware nobody has read.
 */
const UNKNOWN_PAYLOAD: readonly number[] = [
  0x01, 0x01, 0x5a, 0x5b, 0x5c, 0x5d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x88,
  0x01, 0x00, 0x00,
];

/**
 * A second NTAG, for the flows that need two Tags.
 *
 * Copy is the reason: its guard refuses a destination whose UID matches the
 * source, so a single fixture could never reach the confirmation the flow exists
 * to produce. The UID and the smaller NTAG213 capacity are made up; the shape —
 * 7-byte UID, ATQA `44 00`, SAK `00`, a Type 2 container — is the family's.
 */
const NTAG_DEST_PAYLOAD: readonly number[] = [
  0x01, 0x01, 0x04, 0x9a, 0x2b, 0x3c, 0x4d, 0x5e, 0x60, 0x00, 0x00, 0x00, 0x07, 0x44, 0x00, 0x00,
  0x02, 0x00, 0x00,
];

/** The message the NTAG holds: a Text Record and a URL Record, in that order. */
const NTAG_MESSAGE_HEX =
  "91 01 08 54 02 65 6E 68 65 6C 6C 6F 51 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F";

/** The Type 2 TLV wrapper the memory read reports around that message. */
const NTAG_USER_MEMORY_HEX = `03 1E ${NTAG_MESSAGE_HEX} FE`;

/** NTAG215 user memory, from the Capability Container the tag carries. */
const NTAG_CAPACITY = 496;

const DEVICE: DeviceInfo = {
  vid: 0x072f,
  pid: 0x2200,
  product: "NFC-PM4",
  manufacturer: "pm4",
  serial: "STUB00000001",
};

const FIRMWARE = "H00S07";

/** One 13.56 MHz Tag as the stub holds it, fixture-side. */
interface HfFixture {
  readonly uid: string;
  readonly payload: readonly number[];
  /** User memory from the Type 2 Capability Container, or null when unknown. */
  readonly capacityBytes: number | null;
  /** What the Type 2 TLV turned out to be. */
  readonly ndef: TagNdefOutcome;
  /** The message hex the tag holds, when it holds one. */
  readonly messageHex: string;
  /** Whether `0x0081` can read this tag's memory at all. */
  readonly memoryReadable: boolean;
  /** Why the memory could not be read, when it could not. */
  readonly memoryReason: string | null;
}

const NTAG: HfFixture = {
  uid: "04 43 8A 01 22 09 03",
  payload: NTAG_PAYLOAD,
  capacityBytes: NTAG_CAPACITY,
  ndef: "message",
  messageHex: NTAG_MESSAGE_HEX,
  memoryReadable: true,
  memoryReason: null,
};

const NTAG_EMPTY: HfFixture = {
  ...NTAG,
  ndef: "empty",
  messageHex: "",
};

/**
 * The Copy destination: a different UID, a different message, less room than the
 * source's.
 *
 * It holds a message rather than being empty on purpose. Copy currently refuses a
 * destination it cannot name a message for, and an empty Tag is one — a finding
 * recorded in `docs/superpowers/e2e/` rather than papered over here, because a
 * stub that only offers the shapes the app happens to accept would hide exactly
 * the defect this verification is for.
 */
const NTAG_DEST: HfFixture = {
  uid: "04 9A 2B 3C 4D 5E 60",
  payload: NTAG_DEST_PAYLOAD,
  capacityBytes: 144,
  ndef: "message",
  messageHex: "D1 01 0D 54 02 65 6E 6F 6C 64 20 70 6F 73 74 65 72",
  memoryReadable: true,
  memoryReason: null,
};

const CLASSIC: HfFixture = {
  uid: "31 F3 0E 0A",
  payload: CLASSIC_PAYLOAD,
  capacityBytes: null,
  ndef: "notFormatted",
  messageHex: "",
  // MIFARE Classic memory needs sector authentication, and this protocol has no
  // key command at all — the always-case the spec describes.
  memoryReadable: false,
  memoryReason:
    "A MIFARE Classic's memory needs sector authentication, and this Reader has no command for it.",
};

const UNKNOWN: HfFixture = {
  uid: "5A 5B 5C 5D",
  payload: UNKNOWN_PAYLOAD,
  capacityBytes: null,
  ndef: "notFormatted",
  messageHex: "",
  memoryReadable: false,
  memoryReason: "The ATQA/SAK pair matches no published assignment, so nothing is claimed about it.",
};

/* --------------------------------------------------------------------- state */

interface StubState {
  /** The tag the 125 kHz field holds, or null for an empty field. */
  lfTag: LfCard | null;
  /**
   * Whether the 125 kHz tag will accept a write.
   *
   * This is the one thing the Reader cannot report (ADR 0007), so the stub models
   * it as the hidden property it is: a tag already written once refuses, and the
   * only way to find out is to attempt the write.
   */
  lfWritable: boolean;
  /** The tag the 13.56 MHz field holds, or null for an empty field. */
  hfTag: HfFixture | null;
}

const state: StubState = {
  lfTag: SOURCE,
  lfWritable: false,
  hfTag: NTAG,
};

/** Every command the interface sent, for the report and for the panel. */
export const sentCommands: { command: string; args: Record<string, unknown> }[] = [];

function applyLfProfile(profile: LfProfile): void {
  switch (profile) {
    case "source":
      state.lfTag = SOURCE;
      // The tag this project's own probe already wrote once: the Clear that fails.
      state.lfWritable = false;
      break;
    case "blank":
      state.lfTag = BLANK;
      state.lfWritable = true;
      break;
    case "written":
      state.lfTag = SOURCE;
      state.lfWritable = false;
      break;
    case "none":
      state.lfTag = null;
      state.lfWritable = true;
      break;
  }
}

function applyHfProfile(profile: HfProfile): void {
  switch (profile) {
    case "ntag":
      state.hfTag = NTAG;
      break;
    case "ntag-empty":
      state.hfTag = NTAG_EMPTY;
      break;
    case "ntag-dest":
      state.hfTag = NTAG_DEST;
      break;
    case "classic":
      state.hfTag = CLASSIC;
      break;
    case "unknown":
      state.hfTag = UNKNOWN;
      break;
    case "none":
      state.hfTag = null;
      break;
  }
}

/* ------------------------------------------------------------------- library */

const LF_SNAPSHOT: Snapshot = {
  id: SOURCE.id,
  name: "Front door",
  note: "Office street entrance, read at the desk.",
  kind: "LF",
  capturedAt: "2026-11-20T09:14:00.000Z",
  writeCount: 2,
  identity: {
    customer: SOURCE.customer,
    data32: SOURCE.data32,
    facility: SOURCE.facility,
    card: SOURCE.card,
    raw: SOURCE.raw,
  },
};

const HF_SNAPSHOT: Snapshot = {
  id: "04 43 8A 01 22 09 03",
  name: "Lobby poster",
  note: "",
  kind: "HF",
  capturedAt: "2026-11-21T16:02:00.000Z",
  writeCount: 1,
  hf: {
    uid: NTAG.uid,
    raw: NTAG_PAYLOAD.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "),
    atqa: "44 00",
    sak: "00",
    cardType: "NTAG215",
    capacityBytes: NTAG_CAPACITY,
    ndefFormatted: true,
    records: decodeRecordsOrEmpty(NTAG_MESSAGE_HEX),
  },
};

function decodeRecordsOrEmpty(hex: string): DraftRecord[] {
  if (hex.trim() === "") return [];
  try {
    return decodeRecords(hexToBytes(hex));
  } catch {
    return [];
  }
}

const seedDrafts = (): Draft[] => [
  {
    id: "draft-office-wifi",
    name: "Office guest Wi-Fi",
    updatedAt: "2026-11-21T11:30:00.000Z",
    records: [
      {
        kind: "wifi",
        fields: {
          ssid: "PM4-Guest",
          networkKey: "guest-wifi-password",
          auth: "wpa2-personal",
          encryption: "aes",
        },
      },
      { kind: "text", fields: { language: "en", text: "Ask the front desk for the key." } },
    ],
  },
  {
    id: "draft-desk-card",
    name: "Desk contact card",
    updatedAt: "2026-11-19T08:05:00.000Z",
    records: [
      {
        kind: "contact",
        fields: {
          name: "Adrian Bonpin",
          organization: "Devgo Studio",
          phone: "+63 917 000 0000",
          email: "hello@devgo.studio",
        },
      },
    ],
  },
];

let snapshots: Snapshot[] = [LF_SNAPSHOT, HF_SNAPSHOT];
let drafts: Draft[] = seedDrafts();

const LIBRARY_PATH = "/Users/someone/Library/Application Support/pm4-studio/library.json";

function libraryView(): LibraryView {
  return {
    path: LIBRARY_PATH,
    version: 3,
    snapshots,
    problem: null,
    migrationWarning: null,
  };
}

function draftsView(): DraftsView {
  return { drafts, problem: null, migrationWarning: null };
}

/* -------------------------------------------------------------- memory dumps */

const hexByte = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

/** One 4-page row of the dump, from the 16 bytes that sit at that offset. */
function dumpRow(firstPage: number, bytes: readonly number[]): DumpRow {
  const hex = bytes.map(hexByte).join(" ");
  const ascii = bytes.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".")).join("");
  return {
    firstPage,
    lastPage: firstPage + 3,
    offset: firstPage * 4,
    hex,
    ascii,
    pageStates: [1, 1, 1, 1],
    stateLabel: "ok",
    readable: true,
  };
}

/**
 * The pages an NTAG215 shows: UID and Capability Container, then the message.
 *
 * Recorded rather than generated, so the dump on screen is the same evidence the
 * protocol document carries. Nothing here is interpreted; the view names the tag
 * by its UID and its type number only.
 */
const NTAG_DUMP_ROWS: readonly DumpRow[] = [
  dumpRow(0, [
    0x04, 0x43, 0x8a, 0x01, 0x9b, 0x22, 0x09, 0x03, 0x00, 0x00, 0x00, 0x00, 0xe1, 0x10, 0x3e, 0x00,
  ]),
  dumpRow(4, [0x03, 0x1e, 0x91, 0x01, 0x08, 0x54, 0x02, 0x65, 0x6e, 0x68, 0x65, 0x6c, 0x6c, 0x6f,
    0x51, 0x01]),
  dumpRow(8, [0x0d, 0x55, 0x04, 0x64, 0x65, 0x76, 0x67, 0x6f, 0x2e, 0x73, 0x74, 0x75, 0x64, 0x69,
    0x6f, 0xfe]),
  dumpRow(12, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00]),
];

function dumpFor(tag: HfFixture, capturedAt: string): MemoryDump {
  return {
    status: 0,
    tag: { uid: tag.uid, tagType: 0x02, capturedAt },
    pageCount: 256,
    readablePages: NTAG_DUMP_ROWS.length * 4,
    rows: tag.ndef === "message" ? [...NTAG_DUMP_ROWS] : [],
  };
}

/**
 * Why there is no message to load, in the backend's own words.
 *
 * Quoted from `src-tauri/src/tag_records.rs` rather than invented, because the
 * readout and the Copy guard both quote this sentence: a stub that worded it
 * differently would make the page look better than the binary does.
 */
const NDEF_REASON: Record<TagNdefOutcome, string | null> = {
  message: null,
  empty:
    "the tag is NDEF formatted and its NDEF TLV is empty (03 00), so it holds a message of " +
    "zero bytes and therefore no Records",
  missing:
    "the tag is NDEF formatted but its user memory holds no 0x03 NDEF TLV, so it carries no " +
    "NDEF message",
  notFormatted:
    "the tag's user memory does not begin with a Type 2 Capability Container, so it is not " +
    "NDEF formatted and carries no Records",
  unreadable: "a page of the tag's user memory could not be read, so the message is incomplete",
};

function ndefFor(tag: HfFixture): TagNdef {
  const messageBytes = tag.messageHex.trim() === "" ? 0 : hexToBytes(tag.messageHex).length;
  return {
    outcome: tag.ndef,
    messageHex: tag.messageHex,
    messageBytes,
    userMemoryHex: tag.ndef === "empty" ? "03 00 FE" : tag.ndef === "message" ? NTAG_USER_MEMORY_HEX : "",
    userMemoryBytes: NTAG_CAPACITY,
    capacityBytes: tag.capacityBytes,
    userPages: tag.capacityBytes === null ? null : tag.capacityBytes / 4,
    capabilityContainerHex: "E1 10 3E 00",
    reason: NDEF_REASON[tag.ndef],
  };
}

/* -------------------------------------------------------------- the handlers */

type Args = Record<string, unknown>;

const hex = (n: number, width: number) => n.toString(16).toUpperCase().padStart(width, "0");

/** The five-byte id, and the two halves a credential is spoken in. */
function identityFrom(customer: number, data32: number) {
  return {
    customer,
    data32,
    id: `${hex(customer, 2)} ${hex((data32 >>> 24) & 0xff, 2)} ${hex((data32 >>> 16) & 0xff, 2)} ${hex((data32 >>> 8) & 0xff, 2)} ${hex(data32 & 0xff, 2)}`,
    facility: (data32 >>> 16) & 0xff,
    card: data32 & 0xffff,
  };
}

/** The 24-byte `0x0073` payload the Rust codec would build, for the preview. */
function writePayloadHex(customer: number, data32: number): string {
  const payload = new Array<number>(24).fill(0);
  payload[1] = 0x01;
  payload[2] = 0x01;
  payload[8] = customer;
  payload[12] = customer;
  payload[16] = data32 & 0xff;
  payload[17] = (data32 >>> 8) & 0xff;
  payload[18] = (data32 >>> 16) & 0xff;
  payload[19] = (data32 >>> 24) & 0xff;
  return payload.map(hexByte).join(" ");
}

function cardFrom(customer: number, data32: number): LfCard {
  const identity = identityFrom(customer, data32);
  return {
    ...identity,
    raw: `01 01 00 00 00 00 00 ${hex(customer, 2)} 00 00 00 ${hex(identity.card & 0xff, 2)} ${hex((identity.card >>> 8) & 0xff, 2)} ${hex(identity.facility, 2)} 00 00 00 C8 42 01 00 00 00`,
  };
}

/**
 * The placeholder **Clear** writes: customer `0x00`, facility `0xFF`, card
 * `0xFFFF`, i.e. data32 `0x00FF_FFFF`.
 *
 * One definition in the shipping code (`src-tauri/src/identity.rs`,
 * `Identity::CLEARED`); this is the fixture's copy of it, and the id text is what
 * the interface shows because the backend reports it rather than spelling it out.
 */
const CLEARED: LfCard = cardFrom(0x00, 0x00ff_ffff);

/** What a guarded write answers, mirroring the Rust vocabulary and its rules. */
function guardedWrite(customer: number, data32: number) {
  const target = identityFrom(customer, data32);
  if (state.lfTag === null) {
    return {
      outcome: "refused" as const,
      message: "No tag could be read in the write position, so nothing was written.",
      refusalCause: "unreadable" as const,
      readback: null,
      verified: false,
      stillIdentifies: null,
    };
  }
  if (state.lfTag.id === target.id) {
    return {
      outcome: "refused" as const,
      message: `The tag in the write position already presents ${target.id}, so nothing was written.`,
      refusalCause: "already-carries" as const,
      readback: state.lfTag,
      verified: false,
      stillIdentifies: null,
    };
  }
  if (!state.lfWritable) {
    // The chip took the frame and kept its Identity: a fact about the chip, not
    // about the payload (ADR 0007).
    return {
      outcome: "failed" as const,
      message: `The tag still reads as ${state.lfTag.id} after the write, so it did not take it.`,
      refusalCause: null,
      readback: state.lfTag,
      verified: false,
      stillIdentifies: state.lfTag.id,
    };
  }
  state.lfTag = cardFrom(customer, data32);
  return {
    outcome: "verified" as const,
    message: null,
    refusalCause: null,
    readback: state.lfTag,
    verified: true,
    stillIdentifies: null,
  };
}

/** TLV overhead: `03`, the length byte and the `FE` terminator. */
const TLV_OVERHEAD = 3;

const handlers: Record<string, (args: Args) => unknown> = {
  /* ---- the Reader itself ---- */
  connect: () => DEVICE,
  disconnect: () => null,
  device_info: () => DEVICE,
  firmware_version: () => FIRMWARE,
  beep: () => null,
  led_off: () => null,

  /* ---- 125 kHz ---- */
  lf_poll: () => state.lfTag,
  lf_write: (args) => {
    const customer = Number(args.customer ?? 0);
    const data32 = Number(args.data32 ?? 0);
    const result = guardedWrite(customer, data32);
    return {
      customer,
      data32,
      readback: result.readback,
      outcome: result.outcome,
      verified: result.verified,
      message: result.message,
      refusalCause: result.refusalCause,
      confirmedCopies: result.verified ? 3 : null,
      countProblem: null,
    };
  },
  lf_clone_attempt: (args) => {
    const customer = Number(args.customer ?? 0);
    const data32 = Number(args.data32 ?? 0);
    const target = identityFrom(customer, data32);
    if (state.lfTag !== null && state.lfTag.id === target.id) {
      // The case a batch hits by leaving a written tag on the Reader.
      return {
        customer,
        data32,
        outcome: "skipped",
        message: `The tag already presents ${target.id}, so this attempt wrote nothing.`,
        refusalCause: "already-carries",
        readback: state.lfTag,
        confirmedCopies: null,
        countProblem: null,
      };
    }
    const result = guardedWrite(customer, data32);
    return {
      customer,
      data32,
      outcome: result.outcome === "verified" ? "verified" : result.outcome === "refused" ? "refused" : "failed",
      message: result.message,
      refusalCause: result.refusalCause,
      readback: result.readback,
      confirmedCopies: result.verified ? 4 : null,
      countProblem: null,
    };
  },
  lf_clear: (args) => {
    const customer = Number(args.customer ?? 0);
    const data32 = Number(args.data32 ?? 0);
    const operation = String(args.operation ?? "clear") as TagOperation;
    const base = { customer, data32, operation };
    if (state.lfTag === null) {
      return {
        ...base,
        outcome: "refused",
        cleared: false,
        destroyed: false,
        presents: null,
        message: "No tag could be read, so there was nothing to write to.",
      };
    }
    if (!state.lfWritable) {
      // The measured reality of a chip that will not take data: it still reads,
      // and it keeps the Identity it had.
      return {
        ...base,
        outcome: "willNotAcceptWrites",
        cleared: false,
        destroyed: false,
        presents: state.lfTag.id,
        message: "This tag will not accept writes.",
      };
    }
    if (operation === "destroy") {
      // A destroyed tag reads as carrying no Identity, and refuses every later
      // write — which is why the stub flips `lfWritable` as well.
      state.lfTag = null;
      state.lfWritable = false;
      return {
        ...base,
        outcome: "destroyed",
        cleared: false,
        destroyed: true,
        presents: null,
        message: null,
      };
    }
    // A cleared tag carries the placeholder, so it reads as an Identity and is a
    // legal write position for the next Clone or authored Identity.
    state.lfTag = CLEARED;
    return {
      ...base,
      outcome: "cleared",
      cleared: true,
      destroyed: false,
      presents: CLEARED.id,
      message: null,
    };
  },
  lf_identity_preview: (args) => {
    const customer = Number.parseInt(String(args.customer ?? "0"), 10);
    const facility = Number.parseInt(String(args.facility ?? "0"), 10);
    const card = Number.parseInt(String(args.card ?? "0"), 10);
    const data32 = ((facility & 0xff) << 16) | (card & 0xffff);
    return {
      ...identityFrom(customer & 0xff, data32),
      hex: `${hex(customer & 0xff, 2)}${hex(data32 & 0xffff, 4)}`,
      payloadHex: writePayloadHex(customer & 0xff, data32),
    };
  },
  lf_identity_preview_hex: (args) => {
    const bytes = hexToBytes(String(args.hex ?? ""));
    const customer = bytes[0] ?? 0;
    const data32 =
      ((bytes[1] ?? 0) << 24) | ((bytes[2] ?? 0) << 16) | ((bytes[3] ?? 0) << 8) | (bytes[4] ?? 0);
    const identity = identityFrom(customer, data32 >>> 0);
    return {
      ...identity,
      hex: `${hex(customer, 2)}${hex((data32 >>> 0) & 0xffffffff, 8)}`.slice(0, 10),
      payloadHex: writePayloadHex(customer, data32 >>> 0),
    };
  },

  /* ---- 13.56 MHz ---- */
  hf_poll: (): HfCard | null => (state.hfTag === null ? null : { payload: [...state.hfTag.payload] }),
  ntag_memory_read: () => {
    if (state.hfTag === null) throw "no tag is latched in the field";
    if (!state.hfTag.memoryReadable) throw state.hfTag.memoryReason ?? "the tag's memory could not be read";
    return ndefFor(state.hfTag);
  },
  ntag_records_read: (args): TagRecordsRead => {
    if (state.hfTag === null) throw "no tag is latched in the field";
    if (!state.hfTag.memoryReadable) {
      throw state.hfTag.memoryReason ?? "the tag's memory could not be read";
    }
    return {
      dump: dumpFor(state.hfTag, String(args.capturedAt ?? new Date().toISOString())),
      ndef: ndefFor(state.hfTag),
    };
  },
  memory_dump_export: (args) => {
    const dump = args.dump as MemoryDump | undefined;
    const uid = (dump?.tag.uid ?? "tag").split(" ").join("");
    return `/Users/someone/Desktop/pm4-dump-${uid}.txt`;
  },
  hf_ndef_preview: (args) => {
    const messageHex = String(args.messageHex ?? "");
    if (state.hfTag === null) {
      return { tag: null, requiredBytes: 0, capacityBytes: null, fits: false, refusal: "No 13.56 MHz tag is in the field." };
    }
    const requiredBytes = hexToBytes(messageHex).length + TLV_OVERHEAD;
    const capacityBytes = state.hfTag.capacityBytes;
    const fits = capacityBytes !== null && requiredBytes <= capacityBytes;
    return {
      tag: {
        uid: state.hfTag.uid,
        reportedTagType: 0x02,
        capacityBytes,
        userPages: capacityBytes === null ? null : capacityBytes / 4,
        existing: {
          state: state.hfTag.ndef,
          messageHex: state.hfTag.messageHex === "" ? null : state.hfTag.messageHex,
          bytes: state.hfTag.messageHex.trim() === "" ? 0 : hexToBytes(state.hfTag.messageHex).length,
          reason: NDEF_REASON[state.hfTag.ndef],
        },
      },
      requiredBytes,
      capacityBytes,
      fits,
      refusal: fits ? null : "The message does not fit the tag.",
    };
  },
  hf_ndef_write: (args) => {
    const messageHex = String(args.messageHex ?? "");
    const requiredBytes = hexToBytes(messageHex).length + TLV_OVERHEAD;
    const before = state.hfTag;
    if (before === null) throw "no tag is latched in the field";
    if (!before.memoryReadable) throw before.memoryReason ?? "the tag's memory could not be read";
    if (before.capacityBytes !== null && requiredBytes > before.capacityBytes) {
      return {
        outcome: "refused",
        message: "The message is larger than the tag, so nothing was written.",
        before: null,
        after: null,
        capacityBytes: before.capacityBytes,
        requiredBytes,
        wrotePages: [],
        acceptedPages: [],
      };
    }
    const written: HfFixture = {
      ...before,
      ndef: "message",
      messageHex,
    };
    state.hfTag = written;
    const view = {
      uid: written.uid,
      reportedTagType: 0x02,
      capacityBytes: written.capacityBytes,
      userPages: written.capacityBytes === null ? null : written.capacityBytes / 4,
      existing: {
        state: "message",
        messageHex,
        bytes: hexToBytes(messageHex).length,
        reason: null,
      },
    };
    return {
      outcome: "verified",
      message: null,
      before: {
        uid: before.uid,
        reportedTagType: 0x02,
        capacityBytes: before.capacityBytes,
        userPages: before.capacityBytes === null ? null : before.capacityBytes / 4,
        existing: {
          state: before.ndef,
          messageHex: before.messageHex === "" ? null : before.messageHex,
          bytes: before.messageHex.trim() === "" ? 0 : hexToBytes(before.messageHex).length,
          reason: NDEF_REASON[before.ndef],
        },
      },
      after: view,
      capacityBytes: written.capacityBytes,
      requiredBytes,
      wrotePages: [4, 5, 6, 7],
      acceptedPages: [4, 5, 6, 7],
      confirmedCopies: null,
      countChanged: false,
      countProblem: null,
    };
  },
  hf_ndef_erase_preview: () => {
    const tag = state.hfTag;
    if (tag === null) {
      return { tag: null, clearsBytes: 0, pages: [], capacityBytes: null, canErase: false, refusal: "No 13.56 MHz tag is in the field." };
    }
    const bytes = tag.messageHex.trim() === "" ? 0 : hexToBytes(tag.messageHex).length;
    const canErase = bytes > 0;
    return {
      tag: {
        uid: tag.uid,
        reportedTagType: 0x02,
        capacityBytes: tag.capacityBytes,
        userPages: tag.capacityBytes === null ? null : tag.capacityBytes / 4,
        existing: {
          state: tag.ndef,
          messageHex: tag.messageHex === "" ? null : tag.messageHex,
          bytes,
          reason: NDEF_REASON[tag.ndef],
        },
      },
      clearsBytes: bytes === 0 ? 0 : bytes + TLV_OVERHEAD,
      pages: canErase ? [4, 5, 6, 7, 8] : [],
      capacityBytes: tag.capacityBytes,
      canErase,
      refusal: canErase ? null : "The tag already holds no Records, so there is nothing to erase.",
    };
  },
  hf_ndef_erase: () => {
    const tag = state.hfTag;
    if (tag === null) throw "no tag is latched in the field";
    const clearedBytes = tag.messageHex.trim() === "" ? 0 : hexToBytes(tag.messageHex).length;
    state.hfTag = { ...tag, ndef: "empty", messageHex: "" };
    return {
      outcome: "erased",
      message: null,
      before: null,
      after: null,
      capacityBytes: tag.capacityBytes,
      clearedBytes,
      erasePages: [4, 5, 6, 7, 8],
      acceptedPages: [4, 5, 6, 7, 8],
      identityIntact: true,
      writtenHex: "03 00 FE",
    };
  },
  hf_password_status: () => ({
    state: "cannotBeDetermined",
    uid: state.hfTag?.uid ?? null,
    message: "This Reader's firmware cannot read a tag's protection state.",
  }),
  hf_password_set: (args) => ({
    operation: "set",
    refused: true,
    message: "The protocol has no authentication command, so a password could never be satisfied.",
    acknowledged: Boolean(args.acknowledged),
  }),
  hf_password_remove: (args) => ({
    operation: "remove",
    refused: true,
    message: "Removing protection needs an authentication this protocol does not have.",
    acknowledged: Boolean(args.acknowledged),
  }),

  /* ---- the raw console ---- */
  // A development build, which is what the dev server is: the release build's
  // read-only allow-list is a property of the Rust binary, not of this page.
  console_capability: () => ({ readOnly: false, commands: [] }),
  raw_send: (args) => {
    const sent = String(args.hex ?? "");
    return {
      sent,
      cmd: Number.parseInt(sent.slice(0, 4), 16) || 0x0072,
      payload: "55 00 84 82 12 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
      checksum_ok: true,
      raw: sent,
    };
  },
  send_cmd: () => null,

  /* ---- the library ---- */
  library_load: () => libraryView(),
  library_save_lf: (args) => {
    const customer = Number(args.customer ?? 0);
    const data32 = Number(args.data32 ?? 0);
    const identity = identityFrom(customer, data32);
    const existing = snapshots.find((s) => s.kind === "LF" && s.id === identity.id);
    if (existing) {
      return { outcome: "duplicate", library: libraryView(), snapshot: existing };
    }
    const added: Snapshot = {
      id: identity.id,
      name: identity.id,
      note: "",
      kind: "LF",
      capturedAt: String(args.capturedAt ?? new Date().toISOString()),
      writeCount: 0,
      identity: {
        customer,
        data32,
        facility: identity.facility,
        card: identity.card,
        raw: String(args.raw ?? ""),
      },
    };
    snapshots = [added, ...snapshots];
    return { outcome: "added", library: libraryView(), snapshot: added };
  },
  library_save_hf: (args) => {
    const hf = args.hf as {
      uid: string;
      raw: string;
      atqa: string;
      sak: string;
      cardType: string;
      capacityBytes: number | null;
      ndefFormatted: boolean | null;
      records: DraftRecord[] | null;
    };
    const existing = snapshots.find((s) => s.kind === "HF" && s.id === hf.uid);
    if (existing) {
      return { outcome: "duplicate", library: libraryView(), snapshot: existing };
    }
    const added: Snapshot = {
      id: hf.uid,
      name: hf.uid,
      note: "",
      kind: "HF",
      capturedAt: String(args.capturedAt ?? new Date().toISOString()),
      writeCount: 0,
      hf: { ...hf },
    };
    snapshots = [added, ...snapshots];
    return { outcome: "added", library: libraryView(), snapshot: added };
  },
  library_rename: (args) => {
    snapshots = snapshots.map((s) =>
      s.id === String(args.id) ? { ...s, name: String(args.name ?? "") } : s,
    );
    return libraryView();
  },
  library_edit: (args) => {
    snapshots = snapshots.map((s) =>
      s.id === String(args.id)
        ? { ...s, name: String(args.name ?? ""), note: String(args.note ?? "") }
        : s,
    );
    return libraryView();
  },
  library_delete: (args) => {
    snapshots = snapshots.filter((s) => s.id !== String(args.id));
    return libraryView();
  },
  library_pick_file: (args) =>
    args.mode === "import"
      ? "/Users/someone/Desktop/pm4-library-export.json"
      : "/Users/someone/Desktop/pm4-library-export.json",
  library_export: (args) => ({
    path: String(args.path ?? ""),
    snapshots: snapshots.length,
    drafts: drafts.length,
  }),
  library_import_preview: () => ({
    snapshotsAdded: 2,
    snapshotsConflicting: 1,
    draftsAdded: 1,
    draftsConflicting: 0,
  }),
  library_import_apply: () => ({
    preview: { snapshotsAdded: 2, snapshotsConflicting: 1, draftsAdded: 1, draftsConflicting: 0 },
    library: libraryView(),
  }),
  library_reveal: () => LIBRARY_PATH,
  clear_all_saved_data: () => ({
    cleared: true,
    removed: [{ target: "libraryFile", path: LIBRARY_PATH, bytes: 4096 }],
    blocked: null,
  }),

  /* ---- Drafts ---- */
  drafts_load: () => draftsView(),
  draft_create: (args) => {
    const draft: Draft = {
      id: `draft-${drafts.length + 1}-${Date.now()}`,
      name: String(args.name ?? "Untitled"),
      updatedAt: String(args.updatedAt ?? new Date().toISOString()),
      records: [],
    };
    drafts = [draft, ...drafts];
    return draftsView();
  },
  draft_save: (args) => {
    const draft = args.draft as Draft;
    drafts = drafts.map((d) => (d.id === draft.id ? draft : d));
    return draftsView();
  },
  draft_delete: (args) => {
    drafts = drafts.filter((d) => d.id !== String(args.id));
    return draftsView();
  },

  /* ---- plumbing Tauri's own plugins send ---- */
  "plugin:event|listen": () => 1,
  "plugin:event|unlisten": () => null,
};

/* --------------------------------------------------------------------- install */

/** What a caller must tell `installDeviceStub` about the build it is running in. */
export interface StubOptions {
  /**
   * `import.meta.env.PROD` at the call site.
   *
   * A production build must not answer device calls from a fixture, so this is
   * the gate that stays shut: passed `true`, the stub refuses to install and the
   * app is left with no backend at all — which is what a release build with no
   * Reader actually is.
   */
  readonly production: boolean;
  /** Whether to mount the (hidden) field panel. Verification wants it; tests do not. */
  readonly panel?: boolean;
  /** Just enough of `location` to read the fixture profile from. */
  readonly search?: string;
  /** The window to install on. Defaults to the real one. */
  readonly target?: BoundaryTarget & { location?: { search: string } };
}

/** Raised when a production build reaches the stub. */
export class DeviceStubInProductionError extends Error {
  constructor() {
    super(
      "The verification device stub was asked to install in a production build. " +
        "It refuses: a release build must fail rather than answer device calls from a fixture.",
    );
    this.name = "DeviceStubInProductionError";
  }
}

/** The profile parameters a screenshot is reproducible from. */
export function readProfiles(search: string): { lf: LfProfile; hf: HfProfile } {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const lf = params.get("lf");
  const hf = params.get("hf");
  const lfProfiles: readonly LfProfile[] = ["source", "blank", "written", "none"];
  const hfProfiles: readonly HfProfile[] = [
    "ntag",
    "ntag-empty",
    "ntag-dest",
    "classic",
    "unknown",
    "none",
  ];
  return {
    lf: lfProfiles.includes(lf as LfProfile) ? (lf as LfProfile) : "source",
    hf: hfProfiles.includes(hf as HfProfile) ? (hf as HfProfile) : "ntag",
  };
}

/**
 * Stand the fixture backend at the IPC boundary.
 *
 * Called once, before the app renders, from `src/dev/e2e-main.tsx`. Everything
 * the interface then sends is recorded in `sentCommands` and answered from the
 * fixtures above; anything unscripted rejects loudly rather than returning
 * `undefined`, so a command that grew a new reply shape shows up as an error in
 * the page instead of a page that quietly looks fine.
 */
export function installDeviceStub(options: StubOptions): void {
  // First thing, before any fixture is touched: a production build must fail
  // rather than degrade into a working-looking app on invented data. The reason
  // goes on screen as well as into the throw, because the one outcome worse than
  // a refusal is a refusal nobody can see.
  if (options.production) {
    const target = options.target ?? (window as unknown as StubOptions["target"]);
    renderFatalNotice(
      (target ?? {}) as BoundaryTarget,
      "The 13.56 MHz and 125 kHz pages were drawn from a fixture build. " +
        "This bundle carries the verification device stub, so it must not answer a device " +
        "call at all: every reading it could show would be invented. Refusing to run.",
    );
    throw new DeviceStubInProductionError();
  }

  const target = (options.target ?? (window as unknown as StubOptions["target"]))!;
  const search = options.search ?? target.location?.search ?? "";
  const profiles = readProfiles(search);
  applyLfProfile(profiles.lf);
  applyHfProfile(profiles.hf);

  const invoke = async (command: string, args: Args = {}): Promise<unknown> => {
    sentCommands.push({ command, args });
    const handler = handlers[command];
    if (!handler) {
      throw new Error(
        `the verification stub has no answer for "${command}" — add one in src/dev/deviceStub.ts`,
      );
    }
    return await handler(args);
  };

  const internals = {
    invoke,
    // Only `Channel` construction needs this, and nothing on these pages uses one.
    transformCallback: (callback: unknown) => callback,
    // `getCurrentWindow()` reads the label from here before it sends anything.
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
  };

  Object.defineProperty(target, "__TAURI_INTERNALS__", {
    value: internals,
    writable: true,
    configurable: true,
  });

  // The other half of event listening, which `unlisten` calls directly rather
  // than through a command.
  Object.defineProperty(target, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
    value: { unregisterListener: () => {} },
    writable: true,
    configurable: true,
  });

  // The mark `src/lib/deviceBoundary.ts` refuses to let a shipped build render
  // over. Set last, so a throw above can never leave the mark without a backend.
  Object.defineProperty(target, DEVICE_FIXTURE_MARKER, {
    value: {
      module: STUB_MODULE_MARKER,
      profiles,
      beacon: "a verification fixture, not a Reader",
      /** The command log, so an assertion can read it without opening the panel. */
      log: sentCommands,
      /**
       * The same two controls the panel offers, for a driver that is not a human.
       * A tag swap is the one thing a scripted verification cannot do by clicking,
       * so it is reachable directly rather than only through the hidden panel.
       */
      control: { setLf: applyLfProfile, setHf: applyHfProfile },
    },
    writable: true,
    configurable: true,
  });

  if (options.panel ?? true) {
    mountStubPanel({
      target: target as unknown as Window,
      profiles: () => ({ lf: currentLfProfile(), hf: currentHfProfile() }),
      setLf: (profile) => applyLfProfile(profile),
      setHf: (profile) => applyHfProfile(profile),
      log: sentCommands,
    });
  }
}

/** Which profile the 125 kHz field is closest to, for the panel's own display. */
function currentLfProfile(): LfProfile | "custom" {
  if (state.lfTag === null) return "none";
  if (state.lfTag.id === SOURCE.id) return "source";
  if (state.lfTag.id === BLANK.id) return "blank";
  return "custom";
}

/** Which profile the 13.56 MHz field is closest to, for the panel's own display. */
function currentHfProfile(): HfProfile | "custom" {
  if (state.hfTag === null) return "none";
  if (state.hfTag.uid === NTAG.uid) return state.hfTag.ndef === "empty" ? "ntag-empty" : "ntag";
  if (state.hfTag.uid === NTAG_DEST.uid) return "ntag-dest";
  if (state.hfTag.uid === CLASSIC.uid) return "classic";
  return "custom";
}

/** Test seam: forget everything a previous test did. */
export function resetDeviceStubForTest(): void {
  sentCommands.length = 0;
  snapshots = [LF_SNAPSHOT, HF_SNAPSHOT];
  drafts = seedDrafts();
  applyLfProfile("source");
  applyHfProfile("ntag");
}
