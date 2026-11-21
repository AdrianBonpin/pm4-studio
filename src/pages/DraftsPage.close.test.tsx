// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { DraftsPage } from "./DraftsPage";
import { fakeBackend, renderUi, type Backend, type CommandAnswer } from "../test/dom";
import type { Draft, DraftsView } from "../lib/drafts";

/**
 * Story 57: a Draft edit survives quitting.
 *
 * Edits reach the view at once and the file 350 ms later, so quitting inside
 * that quiet period used to lose the last edit — the process went away and the
 * queued write with it. Two things are proven here. First, that a close waits
 * for what is queued and that an idle window does not wait at all. Second, that
 * a final write which does not land holds the window open with the reason and
 * the choice, instead of closing over the loss.
 *
 * The close path is driven the way Rust drives it. `onCloseRequested` registers
 * through `plugin:event|listen`, and this file hands the registered handler the
 * event the backend emits, so the real `@tauri-apps/api/window` code runs — the
 * handler's own decision is what closes the window. What the window then does is
 * read where it happens: a destroyed window is a `plugin:window|destroy` call at
 * the same boundary every other command crosses. No app module is replaced.
 *
 * The fake backend is a store, not a stub: `draft_save` writes the Draft it is
 * sent and `drafts_load` answers from what was written, so rendering the page a
 * second time is a relaunch and reads back exactly what the first run left.
 */

/** A Draft with one empty Text Record, so typing needs no other setup. */
const DRAFT: Draft = {
  id: "draft-1",
  name: "Loading bay sign",
  updatedAt: "2026-11-22T09:00:00.000Z",
  records: [{ kind: "text", fields: { language: "en", text: "" } }],
};

/** The event Rust emits when the user asks the window to close. */
const CLOSE_EVENT = { event: "tauri://close-requested", id: 1, payload: null };

function view(drafts: Draft[]): DraftsView {
  return { drafts, problem: null };
}

interface DraftsStore {
  readonly backend: Backend;
  /** The Drafts the file holds: what a relaunch would read. */
  stored(): Draft[];
  /** The Drafts the file held at the instant the window was destroyed. */
  atClose(): Draft[] | null;
  /** Hold every write at the boundary until the returned release is called. */
  hold(): () => void;
}

/**
 * A fake library that keeps the Drafts written to it.
 *
 * `overrides` replaces one command's answer, for the cases where the file cannot
 * take the write at all.
 */
function draftsStore(overrides: Record<string, CommandAnswer> = {}): DraftsStore {
  let stored: Draft[] = [DRAFT];
  let atClose: Draft[] | null = null;
  let gate: Promise<void> | null = null;

  const backend = fakeBackend({
    drafts_load: () => view(stored),
    draft_save: async (args) => {
      const draft = structuredClone(args.draft as Draft);
      if (gate) await gate;
      stored = [...stored.filter((d) => d.id !== draft.id), draft];
      return view(stored);
    },
    // Destroying the window records what the file held at that moment; that is
    // the evidence for both "the edit was on disk" and "the window really went".
    "plugin:window|destroy": () => {
      atClose = structuredClone(stored);
      return null;
    },
    ...overrides,
  });

  return {
    backend,
    stored: () => stored,
    atClose: () => atClose,
    hold: () => {
      let release = () => {};
      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = null;
          resolve();
        };
      });
      return release;
    },
  };
}

/** The close handler the window registered, once it has registered one. */
async function closeHandler(backend: Backend): Promise<(event: unknown) => Promise<void>> {
  const registered = await waitFor(() => {
    const found = backend
      .callsTo("plugin:event|listen")
      .find((call) => call.args.event === CLOSE_EVENT.event);
    if (!found) throw new Error("the window is not listening for a close request");
    return found;
  });
  return registered.args.handler as (event: unknown) => Promise<void>;
}

/** Deliver a close request the way the backend does, and wait for the outcome. */
async function requestClose(backend: Backend): Promise<void> {
  await (await closeHandler(backend))(CLOSE_EVENT);
}

/** Open the only Draft on the page, so its Records are on screen. */
async function openDraft(user: UserEvent): Promise<HTMLInputElement> {
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  return screen.findByLabelText<HTMLInputElement>("Text");
}

/** Let the queued macrotasks run, without waiting out the quiet period. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Let every promise queued so far settle, without crossing a timer boundary.
 *
 * Work that finishes here needed no delay at all; work that waits on any timer,
 * however short, is still unfinished afterwards.
 */
async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

describe("quitting with a Draft edit still queued", () => {
  it("writes the edit before the window goes, and it reads back on the next launch", async () => {
    const store = draftsStore();
    const first = renderUi(<DraftsPage connected={false} />);
    const text = await openDraft(first.user);

    // Typed and quit at once: the 350 ms quiet period has not elapsed, so the
    // edit exists only in the view and in the queue.
    await first.user.type(text, "Loading bay");
    await requestClose(store.backend);

    // The window went, and what the file held at that instant was the edit.
    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(1);
    expect(recordText(store.atClose()?.[0])).toBe("Loading bay");

    // Relaunch: a new page, reading what the write left behind.
    first.unmount();
    const second = renderUi(<DraftsPage connected={false} />);
    const reread = await openDraft(second.user);
    expect(reread.value).toBe("Loading bay");
  });

  it("waits for a write already on its way, then writes the newest Draft last", async () => {
    const store = draftsStore();
    const { user } = renderUi(<DraftsPage connected={false} />);
    const text = await openDraft(user);

    // Let the first write leave the interface and stop it in flight there.
    const release = store.hold();
    await user.type(text, "one");
    await waitFor(() => {
      expect(savedTexts(store.backend)).toHaveLength(1);
    });

    // A second edit queues while the first write is still out.
    await user.type(text, " two");
    const closing = requestClose(store.backend);

    // The window must not go while a write is out and another is queued.
    await tick();
    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(0);

    release();
    await closing;

    // The write that was in flight went first, the newer one last, so the last
    // bytes to reach the file are the newest state rather than a stale copy.
    expect(savedTexts(store.backend)).toEqual(["one", "one two"]);
    expect(recordText(store.atClose()?.[0])).toBe("one two");
    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(1);
  });

  it("does not count a write that a newer edit overtook as having saved it", async () => {
    const store = draftsStore();
    const { user } = renderUi(<DraftsPage connected={false} />);
    const text = await openDraft(user);

    // A write leaves for the store with "one" in it, and a newer edit arrives
    // while it is out: the store takes "one", but the Draft is not saved.
    const release = store.hold();
    await user.type(text, "one");
    await waitFor(() => {
      expect(savedTexts(store.backend)).toHaveLength(1);
    });
    await user.type(text, " two");
    release();
    await waitFor(() => {
      expect(recordText(store.stored()[0])).toBe("one");
    });

    // Quitting now, inside the quiet period of the newer edit, must write it
    // rather than treat the finished write as the last word on this Draft.
    await requestClose(store.backend);

    expect(recordText(store.atClose()?.[0])).toBe("one two");
    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(1);
  });

  it("closes an idle window without waiting and without writing anything", async () => {
    const store = draftsStore();
    renderUi(<DraftsPage connected={false} />);
    await screen.findByRole("button", { name: "Edit" });
    const handler = await closeHandler(store.backend);

    let closed = false;
    void handler(CLOSE_EVENT).then(() => {
      closed = true;
    });

    // The window is gone before any timer can fire: an idle close waited for
    // nothing, not even a zero-delay delay.
    await drainMicrotasks();
    expect(closed).toBe(true);
    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(1);
    expect(store.backend.callsTo("draft_save")).toHaveLength(0);

    // And the quiet period passes with nothing written, since nothing was edited.
    await tick();
    expect(store.backend.callsTo("draft_save")).toHaveLength(0);
  });

  it("still writes a queued edit when the Drafts page is left, before the quiet period", async () => {
    const store = draftsStore();
    const { user, unmount } = renderUi(<DraftsPage connected={false} />);
    const text = await openDraft(user);

    await user.type(text, "Canteen");
    unmount();

    await tick();
    expect(savedTexts(store.backend)).toEqual(["Canteen"]);
  });
});

describe("quitting when the final save fails", () => {
  it("reports the problem and asks, instead of closing over the loss", async () => {
    const store = draftsStore({
      draft_save: () => {
        throw new Error("the library file could not be written");
      },
    });
    const { user } = renderUi(<DraftsPage connected={false} />);
    const text = await openDraft(user);

    await user.type(text, "Loading bay");
    await requestClose(store.backend);

    // The window is still here, and it says why.
    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(0);
    const prompt = screen.getByRole("alertdialog");
    expect(within(prompt).getByText(/could not be written/)).toBeTruthy();
    expect(within(prompt).getByRole("button", { name: "Keep editing" })).toBeTruthy();

    await user.click(within(prompt).getByRole("button", { name: "Quit anyway" }));

    // Quitting anyway closes, and makes no further attempt at the save.
    await waitFor(() => {
      expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(1);
    });
    expect(store.backend.callsTo("draft_save")).toHaveLength(1);
  });

  it("still refuses to close silently when the user stays and asks again", async () => {
    const store = draftsStore({
      draft_save: () => {
        throw new Error("the library file could not be written");
      },
    });
    const { user } = renderUi(<DraftsPage connected={false} />);
    const text = await openDraft(user);

    await user.type(text, "Loading bay");
    await requestClose(store.backend);
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // The failed write did not become a saved Draft: the next close asks again
    // rather than slipping out over the edit still on screen.
    await requestClose(store.backend);

    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(0);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(store.backend.callsTo("draft_save")).toHaveLength(2);
  });

  it("reports a refused write the same way, and staying keeps the edit", async () => {
    const store = draftsStore({
      draft_save: () => ({
        drafts: [],
        problem: { kind: "corrupt", message: "The library file could not be read" },
      }),
    });
    const { user } = renderUi(<DraftsPage connected={false} />);
    const text = await openDraft(user);

    await user.type(text, "Loading bay");
    await requestClose(store.backend);

    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(0);
    const prompt = screen.getByRole("alertdialog");
    expect(within(prompt).getByText(/could not be read/)).toBeTruthy();

    await user.click(within(prompt).getByRole("button", { name: "Keep editing" }));

    // Still open, the prompt is gone, and the edit is still in the view.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.backend.callsTo("plugin:window|destroy")).toHaveLength(0);
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe("Loading bay");
  });
});

/** The text of the Draft's single Text Record, as it stands on disk. */
function recordText(draft: Draft | undefined): string | null {
  const record = draft?.records[0];
  return record?.kind === "text" ? record.fields.text : null;
}

/** Every Draft the interface has sent to be written, in the order it sent them. */
function savedTexts(backend: Backend): (string | null)[] {
  return backend.callsTo("draft_save").map((call) => recordText(call.args.draft as Draft));
}
