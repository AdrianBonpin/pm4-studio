// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { HfPage } from "./HfPage";
import { DraftsProvider } from "../components/DraftsProvider";
import { fakeBackend, renderUi, type Backend } from "../test/dom";
import { NTAG_CAPTURE, NTAG_UID, recordsRead } from "../test/hfState";
import { ERASE_ACTION_LABEL, eraseConfirmation, type NdefErasePreview } from "../lib/eraseTag";
import { draftMessageHex, type NdefPreview, type NdefWriteResult } from "../lib/tagWrite";
import { HF_MODE_LABEL, HF_MODE_ORDER, type HfMode } from "../lib/hfWorkspace";
import { subscribeSignals, type SignalSymbol } from "../lib/signal";
import type { Draft, DraftsView } from "../lib/drafts";
import type { EraseResult, HfCard, NdefTagSnapshot } from "../types";

/**
 * Ticket 14 — 13.56 MHz is a mode-switched workspace.
 *
 * Read, Write, Copy, Erase and Memory, in that order, one visible at a time and
 * each one click from the others. The page is mounted as the shell mounts it: inside the
 * Drafts provider, with the chosen mode held above the page so it survives a
 * visit to another destination. Only the Tauri boundary is faked.
 *
 * What these tests hold, beyond the shape:
 *   - the password panel is gone from every mode, not hidden behind one;
 *   - Memory holds the read's raw dump and its export, and still calls the dump
 *     evidence rather than a decode;
 *   - the erase and the write are still behind their confirmations after being
 *     re-hosted in a mode — the gate moved with the operation or it did not move;
 *   - switching modes reports nothing, because navigating is not an operation.
 */

const DRAFT: Draft = {
  id: "draft-1",
  name: "Loading bay sign",
  updatedAt: new Date().toISOString(),
  records: [{ kind: "text", fields: { language: "en", text: "Loading bay" } }],
};

/** The Tag the write and erase previews are about. */
const TAG: NdefTagSnapshot = {
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

const PREVIEW: NdefPreview = {
  tag: TAG,
  requiredBytes: draftMessageHex(DRAFT.records).split(" ").length,
  capacityBytes: TAG.capacityBytes,
  fits: true,
  refusal: null,
};

const WRITTEN: NdefWriteResult = {
  outcome: "verified",
  message: null,
  before: TAG,
  after: { ...TAG, existing: { state: "message", messageHex: null, bytes: 20, reason: null } },
  capacityBytes: TAG.capacityBytes,
  requiredBytes: PREVIEW.requiredBytes,
  wrotePages: [4],
  acceptedPages: [4],
};

const ERASE_PREVIEW: NdefErasePreview = {
  tag: TAG,
  clearsBytes: 10,
  pages: [4, 5],
  capacityBytes: TAG.capacityBytes,
  canErase: true,
  refusal: null,
};

const ERASED: EraseResult = {
  outcome: "erased",
  message: null,
  before: TAG,
  after: { ...TAG, existing: { state: "empty", messageHex: null, bytes: 0, reason: null } },
  capacityBytes: TAG.capacityBytes,
  clearedBytes: 10,
  erasePages: [4, 5],
  acceptedPages: [4, 5],
  identityIntact: true,
  writtenHex: "03 00 FE",
};

/** The Drafts collection the app's store would have read at launch. */
function draftsView(drafts: Draft[]): DraftsView {
  return { drafts, problem: null, migrationWarning: null };
}

interface MountOptions {
  readonly drafts?: Draft[];
  readonly card?: HfCard | null;
  readonly answers?: Parameters<typeof fakeBackend>[0];
}

/** Every symbol the audible half was told, for one mount. */
const heard: { symbols: SignalSymbol[]; stop: () => void }[] = [];

afterEach(() => {
  while (heard.length > 0) heard.pop()?.stop();
});

/**
 * The page inside the provider that owns the Drafts queue, with the mode held
 * above it — which is where the shell holds it, so switching destination and
 * coming back returns to the mode the user left.
 */
function mount({ drafts = [], card = NTAG_CAPTURE, answers = {} }: MountOptions = {}) {
  const backend: Backend = fakeBackend({
    drafts_load: () => draftsView(drafts),
    ntag_records_read: () => recordsRead(),
    memory_dump_export: () => "/tmp/ntag215.txt",
    ...answers,
  });
  const signals: SignalSymbol[] = [];
  const stop = subscribeSignals((symbol) => signals.push(symbol));
  heard.push({ symbols: signals, stop });

  function Workspace() {
    const [mode, setMode] = useState<HfMode>("read");
    return <HfPage connected mode={mode} onModeChange={setMode} onPoll={async () => card} />;
  }

  const ui = renderUi(
    <DraftsProvider>
      <Workspace />
    </DraftsProvider>,
  );
  return { backend, ui, signals };
}

/** The workspace switch, as a user finds it. */
function modeSwitch() {
  return screen.getByRole("group", { name: "13.56 MHz mode" });
}

/** One mode's pill. */
function modeButton(mode: HfMode) {
  return within(modeSwitch()).getByRole("button", { name: HF_MODE_LABEL[mode] });
}

describe("the 13.56 MHz workspace's shape", () => {
  it("offers Read, Write, Copy, Erase and Memory in that order, on Read to begin with", () => {
    mount({ drafts: [DRAFT] });

    expect(within(modeSwitch()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Read",
      "Write",
      "Copy",
      "Erase",
      "Memory",
    ]);
    expect(modeButton("read").getAttribute("aria-pressed")).toBe("true");

    // Read is the mode that is showing, and it is the only one.
    expect(screen.getByText("Read a tag")).toBeTruthy();
    expect(screen.queryByText("Memory dump")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Draft to write" })).toBeNull();
    expect(screen.queryByText("Copy a message to another tag")).toBeNull();
    expect(screen.queryByText("Erase a tag's content")).toBeNull();
  });

  it("shows one mode at a time, each one click from the others", async () => {
    const { ui } = mount({ drafts: [DRAFT] });

    await ui.user.click(modeButton("erase"));
    expect(screen.getByText("Erase a tag's content")).toBeTruthy();
    expect(screen.queryByText("Read a tag")).toBeNull();

    await ui.user.click(modeButton("memory"));
    expect(screen.getByText("Memory dump")).toBeTruthy();
    expect(screen.queryByText("Erase a tag's content")).toBeNull();

    await ui.user.click(modeButton("write"));
    expect(screen.getByRole("combobox", { name: "Draft to write" })).toBeTruthy();
    expect(screen.queryByText("Memory dump")).toBeNull();

    await ui.user.click(modeButton("copy"));
    expect(screen.getByText("Copy a message to another tag")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Draft to write" })).toBeNull();

    await ui.user.click(modeButton("read"));
    expect(screen.getByText("Read a tag")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Draft to write" })).toBeNull();
  });

  it("takes the fifth mode in the same row, without relayout", () => {
    mount({ drafts: [DRAFT] });

    // The switch is the shell's Segmented: a single row that counts its options
    // and wraps neither the row nor a label. Copy's arrival added one pill and
    // moved nothing else about the page.
    expect(modeSwitch().className).not.toMatch(/flex-wrap|grid/);
    expect(within(modeSwitch()).getAllByRole("button")).toHaveLength(HF_MODE_ORDER.length);
    for (const button of within(modeSwitch()).getAllByRole("button")) {
      expect(button.className).toContain("whitespace-nowrap");
    }
  });

  it("switches modes without reporting an outcome", async () => {
    const { ui, signals } = mount({ drafts: [DRAFT] });

    for (const mode of ["erase", "memory", "write", "copy", "read"] as const) {
      await ui.user.click(modeButton(mode));
    }

    // Navigating is not an operation: no sound, no message.
    expect(signals).toEqual([]);
  });
});

describe("the password panel", () => {
  it("is not on the page in any mode", async () => {
    const { ui } = mount({ drafts: [DRAFT] });

    for (const mode of ["read", "write", "copy", "erase", "memory"] as const) {
      await ui.user.click(modeButton(mode));
      expect(screen.queryByText("Password protection")).toBeNull();
      expect(screen.queryByRole("button", { name: /password/i })).toBeNull();
    }
  });

  it("leaves no provisional claim on the page either", () => {
    mount();

    // The decode is measured, so there is no provisional badge and no section
    // explaining one — in any mode.
    expect(screen.queryByText(/provisional/i)).toBeNull();
  });
});

describe("Memory", () => {
  it("holds the read's raw dump and its export, and calls the dump evidence", async () => {
    const { backend, ui } = mount();

    await ui.user.click(screen.getByRole("button", { name: "Read tag" }));
    await screen.findByText(NTAG_UID);

    await ui.user.click(modeButton("memory"));

    // The same read's dump: the UID, how much of the memory answered, and the
    // explanation of what the bytes are.
    expect(screen.getByText("Memory dump")).toBeTruthy();
    expect(screen.getByText(NTAG_UID)).toBeTruthy();
    expect(screen.getByText("34 of 256 pages readable")).toBeTruthy();
    expect(screen.getByText(/A dump is evidence, not a decode/)).toBeTruthy();

    const exportButton = screen.getByRole("button", { name: "Export…" });
    expect(exportButton).not.toHaveProperty("disabled", true);
    await ui.user.click(exportButton);

    expect(backend.callsTo("memory_dump_export")).toHaveLength(1);
    await screen.findByText("Saved to /tmp/ntag215.txt");
  });
});

describe("Erase in its mode", () => {
  it("keeps the erase behind its confirmation, and leaves a Tag rather than a Blank", async () => {
    const { backend, ui } = mount({
      answers: {
        hf_ndef_erase_preview: () => ERASE_PREVIEW,
        hf_ndef_erase: () => ERASED,
      },
    });

    await ui.user.click(modeButton("erase"));
    await ui.user.click(screen.getByRole("button", { name: "Check tag" }));

    // Checking read the Tag; only the confirmation's own button erases.
    await screen.findByText(eraseConfirmation(ERASE_PREVIEW).title);
    // The framing survives the move: an erase clears content, and the Tag is
    // still a Tag and still writable afterwards.
    expect(screen.getByText(/^The tag stays a tag\./)).toBeTruthy();
    expect(backend.callsTo("hf_ndef_erase")).toHaveLength(0);

    await ui.user.click(screen.getByRole("button", { name: ERASE_ACTION_LABEL }));
    expect(backend.callsTo("hf_ndef_erase")).toHaveLength(1);

    // Erasing is not a Reset: the Tag is still there, with no Records.
    await screen.findByText("Erased");
    expect(screen.getByText(/reads back as present with no Records/)).toBeTruthy();
    expect(screen.getByText("no Records")).toBeTruthy();
  });
});

describe("Write in its mode", () => {
  it("keeps the write behind its confirmation, with the capacity check and read-back", async () => {
    const { backend, ui } = mount({
      drafts: [DRAFT],
      answers: {
        hf_ndef_preview: () => PREVIEW,
        hf_ndef_write: () => WRITTEN,
      },
    });

    await ui.user.click(modeButton("write"));
    await ui.user.selectOptions(
      screen.getByRole("combobox", { name: "Draft to write" }),
      DRAFT.id,
    );

    await ui.user.click(screen.getByRole("button", { name: "Check tag" }));
    await screen.findByText("Replace the message on the tag with this Draft?");

    // The capacity check is unchanged, and nothing was written to get it.
    expect(screen.getByText(/needs \d+ of the tag's 144 bytes/)).toBeTruthy();
    expect(backend.callsTo("hf_ndef_write")).toHaveLength(0);

    await ui.user.click(screen.getByRole("button", { name: "Write to tag" }));
    expect(backend.callsTo("hf_ndef_write")).toHaveLength(1);

    // The read-back is what reports the write, not the call having returned.
    await screen.findByText("Verified");
    expect(screen.getByText(/reads back message/)).toBeTruthy();
  });

  it("refuses a Draft that does not fit before it writes anything", async () => {
    const { backend, ui } = mount({
      drafts: [DRAFT],
      answers: {
        hf_ndef_preview: () => ({
          ...PREVIEW,
          capacityBytes: 4,
          fits: false,
          refusal: "the message is larger than the tag's memory",
        }),
      },
    });

    await ui.user.click(modeButton("write"));
    await ui.user.selectOptions(
      screen.getByRole("combobox", { name: "Draft to write" }),
      DRAFT.id,
    );
    await ui.user.click(screen.getByRole("button", { name: "Check tag" }));

    await screen.findByText("Not written");
    expect(screen.getByText(/larger than the tag's memory/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Write to tag" })).toBeNull();
    expect(backend.callsTo("hf_ndef_write")).toHaveLength(0);
  });

  it("says where a Draft comes from when there is none to write", async () => {
    const { ui } = mount({ drafts: [] });

    await ui.user.click(modeButton("write"));

    expect(screen.getByText("No Drafts to write")).toBeTruthy();
    expect(screen.getByText(/Library/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Draft to write" })).toBeNull();
  });
});
