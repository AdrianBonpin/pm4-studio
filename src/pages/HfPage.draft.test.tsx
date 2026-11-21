// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { HfPage } from "./HfPage";
import { DraftsProvider } from "../components/DraftsProvider";
import { fakeBackend, renderUi, type CommandAnswer } from "../test/dom";import { MESSAGE, NTAG_CAPTURE, NTAG_UID, recordsRead } from "../test/hfState";
import { libraryState } from "../test/libraryState";
import { encodeRecords } from "../lib/ndef";
import { ndefToRecord } from "../lib/ndef";
import { subscribeSignals, type SignalSymbol } from "../lib/signal";
import { toastStore } from "../lib/toastStore";
import type { Draft, DraftRecord, DraftsView } from "../lib/drafts";

/**
 * Ticket 16 — editing what is on a Tag no longer begins with a trip to another
 * page.
 *
 * The action lives on the readout, with the Records it would copy: present when
 * there are Records, absent when they could not be fetched, because there is
 * nothing to copy. Pressing it once creates the Draft, and the Draft it creates
 * holds the Records exactly as they were read, in the Tag's order.
 *
 * Two claims here are about what the press does *not* do. It does not open a
 * dialog before the Draft exists — a name is a field in the pane, editable in
 * place, not a gate in front of it — and it never writes to the Tag it read. The
 * second is asserted as the whole list of commands the press sent, because "it
 * only wrote the library" is a claim about everything that was not sent.
 *
 * The store is faked at the IPC boundary like every other persisted call, and
 * the fake answers `draft_create`/`draft_save` as a store would, so what the
 * test inspects is what the Draft actually holds rather than a stub's echo.
 */

function view(drafts: Draft[]): DraftsView {
  return { drafts, problem: null, migrationWarning: null };
}

/** A Drafts store behind the IPC boundary: one Draft per create, saved as sent. */
function draftsStore(): { answers: Record<string, CommandAnswer>; stored: Draft[] } {
  const stored: Draft[] = [];
  let next = 0;
  return {
    stored,
    answers: {
      drafts_load: () => view(stored),
      draft_create: (args) => {
        next += 1;
        const draft: Draft = {
          id: `draft-${next}`,
          name: String(args.name ?? ""),
          updatedAt: String(args.updatedAt ?? ""),
          records: [],
        };
        stored.push(draft);
        return view(stored);
      },
      draft_save: (args) => {
        const saved = structuredClone(args.draft as Draft);
        const at = stored.findIndex((held) => held.id === saved.id);
        if (at >= 0) stored[at] = saved;
        return view(stored);
      },
    },
  };
}

/** Render the page inside the provider, listen to the audible half, and read. */
async function readTag(
  answers: Record<string, CommandAnswer>,
  onOpenDraft: (draftId: string) => void = () => {},
) {
  const backend = fakeBackend(answers);
  const symbols: SignalSymbol[] = [];
  const stop = subscribeSignals((symbol) => symbols.push(symbol));
  const { user } = renderUi(
    <DraftsProvider>
      <HfPage
        connected
        mode="read"
        onModeChange={() => {}}
        onPoll={async () => NTAG_CAPTURE}
        library={libraryState()}
        onOpenDraft={onOpenDraft}
      />
    </DraftsProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Read tag" }));
  return { backend, user, symbols, stop };
}

/** The one action this ticket adds, by its words. */
function draftAction(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Edit as Draft" });
}

/** The Records the Tag holds, as a Draft would keep them. */
function recordsOnTheTag(): DraftRecord[] {
  return MESSAGE.map((record) => ndefToRecord(record));
}

describe("the Edit as Draft action, on a readout that holds Records", () => {
  it("is offered once the readout has Records to copy", async () => {
    const { stop } = await readTag({ ntag_records_read: () => recordsRead() });

    await screen.findByText("hello");
    expect(draftAction()).toBeTruthy();
    stop();
  });

  it("is absent when the Records could not be fetched, because there is nothing to copy", async () => {
    const { stop } = await readTag({
      ntag_records_read: () => {
        throw "no answer from the tag";
      },
    });

    // The readout still names the Tag it read, and says the Records are missing.
    await screen.findByText("records not read");
    expect(draftAction()).toBeNull();
    stop();
  });

  it("is absent on a Tag whose message is empty: an empty message is not a Draft to make", async () => {
    const { stop } = await readTag({
      ntag_records_read: () =>
        recordsRead({ outcome: "empty", messageHex: "", messageBytes: 0 }),
    });

    await screen.findByText("empty message");
    expect(draftAction()).toBeNull();
    stop();
  });
});

describe("one press, one Draft", () => {
  it("creates the Draft from the read message, with the Records in the Tag's order", async () => {
    const store = draftsStore();
    const { backend, user, stop } = await readTag({
      ntag_records_read: () => recordsRead(),
      ...store.answers,
    });

    await screen.findByText("hello");
    await user.click(draftAction() as HTMLElement);

    await waitFor(() => expect(backend.callsTo("draft_save")).toHaveLength(1));
    // Exactly one Draft, and its Records are the message's: kind, fields and
    // order all survive the transfer rather than being re-derived from the rows.
    expect(store.stored).toHaveLength(1);
    const [draft] = store.stored;
    expect(draft?.records).toEqual(recordsOnTheTag());

    // And they encode back to the message the Tag accepted, which is what a
    // later write of this Draft would send.
    expect(encodeRecords(draft?.records ?? [])).toEqual(encodeRecords(recordsOnTheTag()));
    stop();
  });

  it("opens with a usable default name, and no dialog before the Draft exists", async () => {
    const store = draftsStore();
    const { backend, user, stop } = await readTag({
      ntag_records_read: () => recordsRead(),
      ...store.answers,
    });

    await screen.findByText("hello");
    // Nothing stands between the press and the Draft: no prompt, no field.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(draftAction() as HTMLElement);

    await waitFor(() => expect(backend.callsTo("draft_create")).toHaveLength(1));
    // The default is the identity the Tag reported: the one fact that tells two
    // readings apart, and the name is a field in the pane that can be renamed.
    expect(backend.callsTo("draft_create")[0]?.args.name).toBe(NTAG_UID);
    stop();
  });

  it("hands the shell the Draft to open, so the user lands in it", async () => {
    const store = draftsStore();
    const open = vi.fn();
    const { user, stop } = await readTag(
      { ntag_records_read: () => recordsRead(), ...store.answers },
      open,
    );

    await screen.findByText("hello");
    await user.click(draftAction() as HTMLElement);

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith(store.stored[0]?.id);
    stop();
  });

  it("never writes to the Tag it was read from", async () => {
    const store = draftsStore();
    const { backend, user, stop } = await readTag({
      ntag_records_read: () => recordsRead(),
      ...store.answers,
    });

    await screen.findByText("hello");
    await user.click(draftAction() as HTMLElement);
    await waitFor(() => expect(backend.callsTo("draft_save")).toHaveLength(1));

    // The read, the Draft, and nothing else: the Tag was not erased, rewritten
    // or formatted, and no write command of any kind was sent.
    const commands = backend.calls.map((call) => call.command);
    expect(commands.filter((command) => /write|erase|format|lock/i.test(command))).toEqual([]);
    // Everything the press sent went to this machine's own library file.
    expect(commands.filter((command) => command.startsWith("draft_"))).toEqual([
      "draft_create",
      "draft_save",
    ]);
    stop();
  });
});

describe("the action reports its own outcome", () => {
  it("sounds one done chirp and says what became of the Draft", async () => {
    const store = draftsStore();
    const { symbols, user, stop } = await readTag({
      ntag_records_read: () => recordsRead(),
      ...store.answers,
    });

    await screen.findByText("hello");
    // The read itself already sounded once; the press must sound its own.
    expect(symbols).toEqual(["done"]);
    await user.click(draftAction() as HTMLElement);

    await waitFor(() => expect(symbols).toEqual(["done", "done"]));
    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toBe(`Draft created from ${NTAG_UID} — 2 Records.`);
    expect(toast?.detail ?? "").toContain("Drafts");
    stop();
  });

  it("says the Draft was not created when the library file could not take it", async () => {
    const open = vi.fn();
    const { symbols, user, stop } = await readTag(
      {
        ntag_records_read: () => recordsRead(),
        drafts_load: () => view([]),
        draft_create: () => view([]),
      },
      open,
    );

    await screen.findByText("hello");
    await user.click(draftAction() as HTMLElement);

    // The store did not report the Draft it created, so nothing is open and the
    // press is reported as the failure it was rather than as a silent no-op.
    await waitFor(() =>
      expect(toastStore.getState().toasts[0]?.message).toBe("The Draft was not created."),
    );
    expect(symbols).toEqual(["done", "attention"]);
    expect(open).not.toHaveBeenCalled();
    stop();
  });
});
