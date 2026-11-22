// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { ClearTag } from "./components/ClearTag";
import { BatchMode } from "./components/BatchMode";
import { AuthorIdentity } from "./components/AuthorIdentity";
import { CloneWizard } from "./components/CloneWizard";
import { CopyMessage } from "./components/CopyMessage";
import { DraftsProvider } from "./components/DraftsProvider";
import { EraseNdef } from "./components/EraseNdef";
import { WriteDraftToTag } from "./components/WriteDraftToTag";
import { fakeBackend, renderUi, type CommandAnswer } from "./test/dom";
import { NTAG_CAPTURE, NTAG_UID, recordsRead } from "./test/hfState";
import { SNAPSHOT, libraryState } from "./test/libraryState";
import type { SaveResult } from "./lib/library";
import { ERASE_ACTION_LABEL } from "./lib/eraseTag";
import { CLEAR_ACTION_LABEL, CLEAR_READ_CONTROL } from "./lib/clearTag";
import { textRecord } from "./lib/ndef";
import { draftMessageHex } from "./lib/tagWrite";
import { subscribeSignals, type SignalSymbol } from "./lib/signal";
import { toastStore } from "./lib/toastStore";
import { ALL_OUTCOME_OPERATIONS, type OutcomeKind, type OutcomeOperation } from "./lib/outcome";
import { HfPage } from "./pages/HfPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LfPage } from "./pages/LfPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToolsPage } from "./pages/ToolsPage";
import type { LibraryState } from "./hooks/useLibrary";
import type { Draft, DraftsView } from "./lib/drafts";
import type { EraseResult, HfCard, LfCard, NdefTagSnapshot, WriteOutcome, WriteResult } from "./types";

/**
 * The enumeration: every operation this app can report, driven once, here.
 *
 * ADR 0008 makes coverage a property of the structure rather than of discipline:
 * "an operation the user starts ends in exactly one outcome". A structure cannot
 * claim that unless something enumerates the operations and drives each one, so
 * this file is that list. Each row names one operation the way a user meets it,
 * performs it against the scripted device boundary, and asserts two things:
 *
 *   1. the newest message on screen carries the operation and the discriminator
 *      the specification's signal table gives that kind of result; and
 *   2. the last symbol the audible half was handed is the one that table gives
 *      that symbol's severity — one chirp done, two needs-you, three attention.
 *
 * Both expected values are written down here, from the table, rather than derived
 * from `SEVERITY_OF` and `signalFor`: a test that reads its expectations out of
 * the thing it is testing cannot fail when that thing is wrong.
 *
 * # Why this bites
 *
 * Delete a `report(...)` call from any row's operation and *that row* fails: the
 * message never appears, so (1) has nothing to match, and the sound that used to
 * follow it is gone. That is the property ticket 17 asks for, and it is the
 * reason this is a table of operations rather than a table of kinds: a kind
 * table passes when one of the two call sites that produce it is silenced.
 *
 * A newly added operation cannot pass by omission. `OutcomeOperation` is the
 * closed set of operations the vocabulary names, and the last test here asserts
 * that this table covers it exactly. Adding an operation means adding a
 * discriminator to that union (`lib/outcome.ts` is where that decision is
 * written down), which fails that test until a row drives it — and a row cannot
 * pass until the operation actually reports. The decision cannot be skipped,
 * which is the point.
 *
 * The boundary is the invoke boundary, as everywhere else: these drive the real
 * components, hooks and modules, and only the webview's edge is scripted.
 */

/** The 125 kHz Tag these rows use: the Identity every confirmation names. */
const LF_CARD: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "55 00 84 82 12",
};

/** The Identity the authored write is minted from. */
const AUTHORED = "55 00 84 82 12";

/** The Tag in the write position while authoring: a different Identity. */
const POSITION: LfCard = {
  customer: 0x77,
  data32: 0x00ab_cdef,
  id: "77 00 AB CD EF",
  facility: 0xab,
  card: 0xcdef,
  raw: "77 00 AB CD EF",
};

/** What the Rust codec answers for `AUTHORED`. */
const PREVIEW = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: AUTHORED,
  hex: "5500848212",
  facility: 0x84,
  card: 0x8212,
  payloadHex: "55 00 84 82 12 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
};

/** One 125 kHz write, as the guard reports it. */
function writeResult(outcome: WriteOutcome): WriteResult {
  return {
    customer: LF_CARD.customer,
    data32: LF_CARD.data32,
    readback: outcome === "verified" ? LF_CARD : null,
    outcome,
    verified: outcome === "verified",
    message: null,
    refusalCause: null,
    confirmedCopies: null,
    countProblem: null,
  };
}

/** The library file, as the store reports it back after a save. */
function libraryViewWith(snapshots = [SNAPSHOT]): SaveResult["library"] {
  return {
    path: "/tmp/library.json",
    version: 3,
    snapshots,
    problem: null,
    migrationWarning: null,
  };
}

/** A 125 kHz Snapshot save: what the store answers when it added one. */
const SAVED_LF: SaveResult = {
  outcome: "added",
  library: libraryViewWith(),
  snapshot: SNAPSHOT,
};

/** A 13.56 MHz read kept: the same answer, for a Snapshot of that band. */
const SAVED_HF: SaveResult = {
  outcome: "added",
  library: libraryViewWith([{ ...SNAPSHOT, id: NTAG_UID, kind: "HF" }]),
  snapshot: { ...SNAPSHOT, id: NTAG_UID, kind: "HF" },
};

/** What the page's own save hands back. */
const savedHf = () => SAVED_HF;

/** One clear that left the placeholder behind. */
const CLEARED = {
  customer: LF_CARD.customer,
  data32: LF_CARD.data32,
  operation: "clear" as const,
  outcome: "cleared" as const,
  cleared: true,
  destroyed: false,
  presents: "00 00 FF FF FF",
  message: null,
};

/** The 13.56 MHz Tag whose capture is in `docs/PROTOCOL.md`. */
const HF_TAG: NdefTagSnapshot = {
  uid: "04 A2 24 5A 6C 71 80",
  reportedTagType: 0x02,
  capacityBytes: 144,
  userPages: 36,
  existing: {
    state: "message",
    messageHex: "D1 01 05 55 03 67 6F 6F 67 00 FE",
    bytes: 10,
    reason: null,
  },
};

/** The 13.56 MHz erase, as the backend reports it. */
const ERASED: EraseResult = {
  outcome: "erased",
  message: null,
  before: HF_TAG,
  after: { ...HF_TAG, existing: { state: "empty", messageHex: null, bytes: 0, reason: null } },
  capacityBytes: HF_TAG.capacityBytes,
  clearedBytes: 10,
  erasePages: [4, 5],
  acceptedPages: [4, 5],
  identityIntact: true,
  writtenHex: "03 00 FE",
};

/** One screen's worth, as a user meets it. */
interface Operation {
  /** What the user did, in the words the app uses for it. */
  readonly name: string;
  /** The operation the vocabulary names, as `lib/outcome.ts` spells it. */
  readonly operation: OutcomeOperation;
  /** The discriminator the report must carry for this result. */
  readonly kind: OutcomeKind;
  /** The symbol the alphabet table gives that severity, written down. */
  readonly signal: SignalSymbol;
  /** A phrase the message must contain, in the operation's own words. */
  readonly says: string;
  /** Perform the operation with the device boundary scripted. */
  readonly run: () => Promise<void>;
}

/** A Drafts store behind the IPC boundary, for the page that needs one. */
function draftsStore(): Record<string, CommandAnswer> {
  const stored: Draft[] = [];
  const view = (): DraftsView => ({ drafts: stored, problem: null, migrationWarning: null });
  let next = 0;
  return {
    drafts_load: () => view(),
    draft_create: (args) => {
      next += 1;
      stored.push({
        id: `draft-${next}`,
        name: String(args.name ?? ""),
        updatedAt: String(args.updatedAt ?? ""),
        records: [],
      });
      return view();
    },
    draft_save: () => view(),
  };
}

/** The 13.56 MHz page, inside the Drafts provider it reads its store from. */
function renderHfPage(
  answers: Record<string, CommandAnswer>,
  library: LibraryState = libraryState(),
) {
  fakeBackend({ ...draftsStore(), ntag_records_read: () => recordsRead(), ...answers });
  return renderUi(
    <DraftsProvider>
      <HfPage
        connected
        mode="read"
        onModeChange={() => {}}
        onPoll={async () => NTAG_CAPTURE}
        library={library}
        onOpenDraft={() => {}}
      />
    </DraftsProvider>,
  );
}

/** A poll reply for a Tag that answers 00 44 / 00, the NTAG family. */
function pollReply(uid: string): HfCard {
  const bytes = uid.split(" ").map((part) => Number.parseInt(part, 16));
  const buffer = [...bytes, ...Array.from({ length: 10 - bytes.length }, () => 0)];
  return { payload: [0x01, 0x01, ...buffer, bytes.length, 0x44, 0x00, 0x00, 0x02, 0x00, 0x00] };
}

/** What the field holds, for the flow that makes the user swap Tags by hand. */
function copyField(): {
  poll: () => HfCard | null;
  remove: () => void;
  latch: (card: HfCard) => void;
} {
  let card: HfCard | null = NTAG_CAPTURE;
  return {
    poll: () => card,
    remove: () => {
      card = null;
    },
    latch: (next) => {
      card = next;
    },
  };
}

/** Settings, with the Reader attached and the quiet level audible. */
function renderSettings(answers: Record<string, CommandAnswer> = {}) {
  fakeBackend({ beep: () => null, console_capability: () => ({ readOnly: false, commands: [] }), ...answers });
  return renderUi(
    <SettingsPage
      reader={{ connected: true, info: null, firmware: null }}
      quietLevel="all"
      onQuietLevelChange={() => {}}
      library={libraryState()}
    />,
  );
}

/**
 * Every operation, one row each.
 *
 * The order follows the work: the two band pages in their mode order, then
 * Library, then the shell, then Settings.
 */
const OPERATIONS: readonly Operation[] = [
  {
    name: "125 kHz Read: a Tag latched",
    operation: "read",
    kind: "read",
    signal: "done",
    says: `Read ${LF_CARD.id}.`,
    run: async () => {
      fakeBackend({ lf_poll: () => LF_CARD });
      const { user } = renderUi(<LfPage connected library={libraryState()} />);
      await user.click(screen.getByRole("button", { name: "Read tag" }));
    },
  },
  {
    name: "125 kHz Read: the read kept in the library",
    operation: "library",
    kind: "saved",
    signal: "done",
    says: "Saved to the library as",
    run: async () => {
      fakeBackend({ lf_poll: () => LF_CARD });
      const { user } = renderUi(
        <LfPage
          connected
          library={libraryState({ saveLf: async () => SAVED_LF })}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Read tag" }));
      // The Identity appears twice on the readout: large, and in the collapsed
      // raw payload. Either is enough to know the read landed.
      await screen.findAllByText(LF_CARD.id);
      await user.click(screen.getByRole("button", { name: "Save to library" }));
    },
  },
  {
    name: "125 kHz Write: an Identity authored and written",
    operation: "write",
    kind: "verified",
    signal: "done",
    says: "Verified",
    run: async () => {
      fakeBackend({
        lf_identity_preview_hex: () => PREVIEW,
        lf_poll: () => POSITION,
        lf_write: () => writeResult("verified"),
      });
      const { user } = renderUi(<AuthorIdentity connected library={libraryState()} />);
      await user.click(screen.getByRole("button", { name: "Five-byte hex" }));
      await user.type(screen.getByLabelText("Five-byte Identity"), AUTHORED);
      await user.click(screen.getByRole("button", { name: "Preview the Identity" }));
      await user.click(await screen.findByRole("button", { name: "Read the tag, then write" }));
      await user.click(
        await screen.findByRole("button", {
          name: `Replace ${POSITION.id} with ${AUTHORED}`,
        }),
      );
    },
  },
  {
    name: "125 kHz Write: a Snapshot written back to a Tag",
    operation: "write",
    kind: "verified",
    signal: "done",
    says: "Verified",
    run: async () => {
      fakeBackend({ lf_write: () => writeResult("verified") });
      const { user } = renderUi(<LibraryPage connected library={libraryState()} />);
      await user.click(screen.getByRole("button", { name: "Write to tag" }));
    },
  },
  {
    name: "125 kHz Clear: the Tag read to clear",
    operation: "clear",
    kind: "read",
    signal: "done",
    says: `Read ${LF_CARD.id}.`,
    run: async () => {
      fakeBackend({ lf_poll: () => LF_CARD });
      const { user } = renderUi(<ClearTag connected />);
      await user.click(screen.getByRole("button", { name: CLEAR_READ_CONTROL }));
    },
  },
  {
    name: "125 kHz Clear: the clearing write",
    operation: "clear",
    kind: "cleared",
    signal: "done",
    says: "Cleared —",
    run: async () => {
      fakeBackend({ lf_poll: () => LF_CARD, lf_clear: () => CLEARED });
      const { user } = renderUi(<ClearTag connected />);
      await user.click(screen.getByRole("button", { name: CLEAR_READ_CONTROL }));
      await user.click(
        await screen.findByRole("button", { name: CLEAR_ACTION_LABEL }),
      );
    },
  },
  {
    name: "125 kHz Clear: the Reader could not send it",
    operation: "reader",
    kind: "reader-wedged",
    // A wedged Reader is attached and broken: the write failed and only a replug
    // clears it, so it is attention. An absent Reader is the silent state; a
    // wedged one is a fault.
    signal: "attention",
    says: "The Reader stopped responding",
    run: async () => {
      fakeBackend({
        lf_poll: () => LF_CARD,
        lf_clear: () => {
          throw new Error("I/O Timeout: the reader stopped answering");
        },
      });
      const { user } = renderUi(<ClearTag connected />);
      await user.click(screen.getByRole("button", { name: CLEAR_READ_CONTROL }));
      await user.click(
        await screen.findByRole("button", { name: CLEAR_ACTION_LABEL }),
      );
    },
  },
  {
    name: "125 kHz Clone: the original read",
    operation: "clone",
    kind: "read",
    signal: "done",
    says: `Read ${LF_CARD.id} — the original.`,
    run: async () => {
      fakeBackend({ lf_poll: () => LF_CARD });
      const { user } = renderUi(<CloneWizard connected />);
      await user.click(screen.getByRole("button", { name: "Start clone" }));
    },
  },
  {
    name: "125 kHz Batch: an attempt on one Blank",
    operation: "batch",
    kind: "verified",
    signal: "done",
    says: "Verified",
    run: async () => {
      fakeBackend({
        lf_poll: () => LF_CARD,
        lf_clone_attempt: () => ({
          customer: LF_CARD.customer,
          data32: LF_CARD.data32,
          outcome: "verified",
          message: null,
          refusalCause: null,
          readback: LF_CARD,
          confirmedCopies: 1,
          countProblem: null,
        }),
      });
      const { user } = renderUi(<BatchMode connected />);
      await user.click(screen.getByRole("button", { name: /Read the tag to copy/ }));
      await user.click(
        await screen.findByRole("button", { name: /Write the blank on the reader/ }),
      );
    },
  },
  {
    name: "13.56 MHz Read: the poll and the message in one action",
    operation: "hf-read",
    kind: "read",
    signal: "done",
    says: `Read ${NTAG_UID}`,
    run: async () => {
      const { user } = renderHfPage({});
      await user.click(screen.getByRole("button", { name: "Read tag" }));
    },
  },
  {
    name: "13.56 MHz Read: the read kept in the library",
    operation: "library",
    kind: "saved",
    signal: "done",
    says: "Saved to the library as",
    run: async () => {
      // The page's save goes through the library prop rather than a command, so
      // it is scripted by handing the page a store that answers as the file's
      // store would.
      const { user } = renderHfPage(
        {},
        libraryState({ saveHf: async () => savedHf() }),
      );
      await user.click(screen.getByRole("button", { name: "Read tag" }));
      await screen.findByText("hello");
      await user.click(screen.getByRole("button", { name: "Save to library" }));
    },
  },
  {
    name: "13.56 MHz Read: the message became a Draft",
    operation: "draft",
    kind: "drafted",
    signal: "done",
    says: `Draft created from ${NTAG_UID}`,
    run: async () => {
      const { user } = renderHfPage({});
      await user.click(screen.getByRole("button", { name: "Read tag" }));
      await screen.findByText("hello");
      await user.click(screen.getByRole("button", { name: "Edit as Draft" }));
    },
  },
  {
    name: "13.56 MHz Write: a Draft's Records written to a Tag",
    operation: "write",
    kind: "verified",
    signal: "done",
    says: "Verified",
    run: async () => {
      const records = [{ kind: "text" as const, fields: { language: "en", text: "Loading bay" } }];
      fakeBackend({
        hf_ndef_preview: () => ({
          tag: HF_TAG,
          requiredBytes: draftMessageHex(records).split(" ").length,
          capacityBytes: HF_TAG.capacityBytes,
          fits: true,
          refusal: null,
        }),
        hf_ndef_write: () => ({
          outcome: "verified",
          message: null,
          before: HF_TAG,
          after: HF_TAG,
          capacityBytes: HF_TAG.capacityBytes,
          requiredBytes: 20,
          wrotePages: [4],
          acceptedPages: [4],
        }),
      });
      const { user } = renderUi(<WriteDraftToTag records={records} connected />);
      await user.click(screen.getByRole("button", { name: "Check tag" }));
      await user.click(await screen.findByRole("button", { name: "Write to tag" }));
    },
  },
  {
    name: "13.56 MHz Copy: a whole message onto another Tag",
    operation: "copy",
    kind: "verified",
    signal: "done",
    says: "Copied",
    run: async () => {
      const field = copyField();
      // One read command, two answers: the source's message before the swap and
      // the destination's after it, chosen by which Tag the poll latched.
      const source = recordsRead();
      // A different message from the source's: a destination that already holds
      // the source's message is a refusal, not a copy.
      const destination = recordsRead({}, HF_TAG.uid, [textRecord("en", "loading bay")]);
      let atDestination = false;
      fakeBackend({
        ntag_records_read: () => (atDestination ? destination : source),
        hf_ndef_write: () => ({
          outcome: "verified",
          message: null,
          before: HF_TAG,
          after: HF_TAG,
          capacityBytes: 496,
          requiredBytes: 10,
          wrotePages: [4, 5],
          acceptedPages: [4, 5],
        }),
      });
      const { user } = renderUi(<CopyMessage connected onPoll={async () => field.poll()} />);
      await user.click(screen.getByRole("button", { name: "Read source tag" }));
      await screen.findByText(/Source message held/);
      field.remove();
      await user.click(screen.getByRole("button", { name: "Check the field" }));
      await screen.findByText(/Nothing is latched/);
      field.latch(pollReply(HF_TAG.uid));
      atDestination = true;
      await user.click(screen.getByRole("button", { name: "Read destination tag" }));
      await user.click(await screen.findByRole("button", { name: "Copy to this tag" }));
    },
  },
  {
    name: "13.56 MHz Erase: the Tag's content cleared",
    operation: "erase",
    kind: "erased",
    signal: "done",
    says: "Erased",
    run: async () => {
      fakeBackend({
        hf_ndef_erase_preview: () => ({
          tag: HF_TAG,
          clearsBytes: 10,
          pages: [4, 5],
          capacityBytes: HF_TAG.capacityBytes,
          canErase: true,
          refusal: null,
        }),
        hf_ndef_erase: () => ERASED,
      });
      const { user } = renderUi(<EraseNdef connected />);
      await user.click(screen.getByRole("button", { name: "Check tag" }));
      await user.click(
        await screen.findByRole("button", { name: ERASE_ACTION_LABEL }),
      );
    },
  },
  {
    name: "Tools: a frame this build refused to send",
    operation: "console",
    kind: "refused-by-build",
    signal: "attention",
    says: "was not sent",
    run: async () => {
      fakeBackend({
        console_capability: () => ({ readOnly: true, commands: [] }),
        raw_send: () => {
          throw {
            kind: "refusedByBuild",
            cmd: "0x0073",
            message: "this build sends only commands that cannot change a tag",
          };
        },
      });
      const { user } = renderUi(<ToolsPage connected />);
      await user.click(screen.getByRole("button", { name: "Send" }));
    },
  },
  {
    name: "Settings: the beeper test",
    operation: "preferences",
    kind: "beep-test",
    signal: "done",
    says: "Signal sent.",
    run: async () => {
      const { user } = renderSettings();
      await user.click(screen.getByRole("button", { name: "Beep test" }));
    },
  },
  {
    name: "Settings: every saved thing cleared",
    operation: "preferences",
    kind: "data-cleared",
    signal: "done",
    says: "Cleared all saved data.",
    run: async () => {
      const { user } = renderSettings({
        clear_all_saved_data: () => ({
          cleared: true,
          removed: [{ target: "libraryFile", path: "/tmp/library.json", bytes: 2048 }],
          blocked: null,
        }),
      });
      await user.click(
        within(screen.getByRole("group", { name: "Settings group" })).getByRole("button", {
          name: "Data",
        }),
      );
      await user.type(screen.getByLabelText("Type clear to confirm"), "clear");
      await user.click(screen.getByRole("button", { name: "Clear all saved data" }));
    },
  },
];

/** Every symbol the audible half was told during the row that is running. */
let heard: SignalSymbol[] = [];
let stopHearing: (() => void) | null = null;

beforeEach(() => {
  toastStore.clear();
  heard = [];
  stopHearing = subscribeSignals((symbol) => heard.push(symbol));
});

afterEach(() => {
  stopHearing?.();
  stopHearing = null;
});

describe("every operation the vocabulary names", () => {
  it("is enumerated here, so a new one cannot be silent by omission", () => {
    // The set is the ticket. A new discriminator in `OutcomeOperation` — which is
    // how an operation is added, and the place where its outcome is decided —
    // fails this until a row drives it, and a row cannot pass until it reports.
    expect([...new Set(OPERATIONS.map((op) => op.operation))].sort()).toEqual(
      [...ALL_OUTCOME_OPERATIONS].sort(),
    );
  });

  it("has one row per entry, and every row names itself", () => {
    const names = OPERATIONS.map((op) => op.name);
    expect(new Set(names).size).toBe(names.length);
    for (const op of OPERATIONS) expect(op.name.trim()).not.toBe("");
  });
});

for (const op of OPERATIONS) {
  it(`${op.name} reports ${op.kind}, and is heard as ${op.signal}`, async () => {
    await op.run();

    // The newest message is this operation's: the words are the vocabulary's,
    // the discriminator is the one this result gets, and the operation is the
    // one it belongs to.
    await expectNewestToBe(op);

    // And the sound that accompanied it is the one the alphabet table gives that
    // severity. Written down in the row, never derived from the mapping.
    expect(heard[heard.length - 1], op.name).toBe(op.signal);
  });
}

/**
 * Wait for the operation's own message to be the newest one.
 *
 * A flow reports each step as it completes (a Clone's two reads, a Clear's read
 * before its write), so the assertion waits for the row's own outcome rather
 * than for anything to have been said at all.
 */
async function expectNewestToBe(op: Operation): Promise<void> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const newest = toastStore.getState().toasts[0];
    if (newest?.operation === op.operation && newest.kind === op.kind) {
      expect(newest.message).toContain(op.says);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${op.name} did not report ${op.kind}: the newest message is ` +
          `${JSON.stringify(newest?.message ?? null)} (${newest?.kind ?? "none"})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
