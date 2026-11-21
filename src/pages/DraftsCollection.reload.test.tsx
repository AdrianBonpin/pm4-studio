// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { DraftsCollection } from "./DraftsCollection";
import { DraftsProvider, useDraftsState } from "../components/DraftsProvider";
import { fakeBackend, renderUi, type Backend } from "../test/dom";
import type { Draft, DraftsView } from "../lib/drafts";

/**
 * Reading the Drafts list while an edit is on its way to the file.
 *
 * `reload` is the one read the app makes: at launch, and again when the Drafts
 * Collection is opened, because the list can change elsewhere — an import adds
 * Drafts — and the Collection must be fresh when the user gets there. A read is not
 * atomic with the writes around it, though, and the failure that matters is
 * visible rather than theoretical: an edit is queued, a write is out, a read is
 * asked for, the write lands and clears the queue, and the read's reply — bytes
 * from *before* that write — arrives afterwards and becomes the view. Every
 * keystroke after that carries the older text, so the next save writes the edit
 * away.
 *
 * The interleaving is modelled at the IPC boundary, where the reply's age is
 * decided: `drafts_load` is answered from the file as it stood when the read was
 * issued, and both the read and the write are held there so the test decides
 * which lands first. The same file drives the fixed and the broken shape —
 * nothing here depends on how the hook avoids the overwrite.
 */

/** A Draft with one empty Text Record, so typing needs no other setup. */
const DRAFT: Draft = {
  id: "draft-1",
  name: "Loading bay sign",
  updatedAt: "2026-11-22T09:00:00.000Z",
  records: [{ kind: "text", fields: { language: "en", text: "" } }],
};

function view(drafts: Draft[]): DraftsView {
  return { drafts, problem: null, migrationWarning: null };
}

interface DraftsStore {
  readonly backend: Backend;
  /** The Drafts the file holds: what a read issued now would answer. */
  stored(): Draft[];
  /** Hold the next write at the boundary until the returned release is called. */
  holdSave(): () => void;
  /** Hold every read from now on, keeping the bytes it was answered from. */
  holdLoad(): () => void;
}

/**
 * A fake library that keeps what is written to it, and can hold either half of
 * the traffic so a test can choose which reply lands first.
 *
 * `drafts_load` is answered from a copy of the file taken when the read is
 * *issued*, not when the test lets it through: that is what makes a held reply an
 * old reply, and the age of the reply is the whole hazard.
 */
function draftsStore(): DraftsStore {
  let stored: Draft[] = [DRAFT];
  let saveGate: Promise<void> | null = null;
  let loadGate: Promise<void> | null = null;

  const backend = fakeBackend({
    drafts_load: async () => {
      const bytes = structuredClone(stored);
      if (loadGate) await loadGate;
      return view(bytes);
    },
    draft_save: async (args) => {
      const draft = structuredClone(args.draft as Draft);
      if (saveGate) await saveGate;
      stored = [...stored.filter((d) => d.id !== draft.id), draft];
      return view(stored);
    },
  });

  return {
    backend,
    stored: () => stored,
    holdSave: () => {
      let release = () => {};
      saveGate = new Promise<void>((resolve) => {
        release = () => {
          saveGate = null;
          resolve();
        };
      });
      return release;
    },
    holdLoad: () => {
      let release = () => {};
      loadGate = new Promise<void>((resolve) => {
        release = () => {
          loadGate = null;
          resolve();
        };
      });
      return release;
    },
  };
}

/**
 * The page, plus the one control the app offers no user-facing copy of.
 *
 * `reload` is the hook's own read — the Collection calls it on mount and after a
 * failed delete — so a button that calls it drives exactly the code the app runs. It
 * exists because the hazard needs a read to be asked for while a write is out,
 * and that is a moment no click in the interface can otherwise produce on demand.
 */
function DraftsWithRefresh() {
  const drafts = useDraftsState();
  return (
    <>
      <button onClick={() => void drafts.reload()}>Refresh</button>
      <DraftsCollection connected={false} />
    </>
  );
}

function renderDrafts(): ReturnType<typeof renderUi> {
  return renderUi(
    <DraftsProvider>
      <DraftsWithRefresh />
    </DraftsProvider>,
  );
}

/**
 * Open the only Draft in the Collection, so its Records are on screen.
 *
 * The first Draft opens on arrival, and clicking the open row closes the pane
 * again — the same toggle the Snapshot list has — so this clicks only when the
 * editor is not already showing.
 */
async function openDraft(user: UserEvent): Promise<HTMLInputElement> {
  const list = await screen.findByRole("list", { name: "Drafts" });
  const row = within(list).getByRole("button", { name: /^Loading bay sign —/ });
  if (row.getAttribute("aria-pressed") !== "true") await user.click(row);
  return screen.findByLabelText<HTMLInputElement>("Text");
}

/** The text of the Draft's single Text Record, as it stands on disk. */
function recordText(draft: Draft | undefined): string | null {
  const record = draft?.records[0];
  return record?.kind === "text" ? record.fields.text : null;
}

/** Let the queued macrotasks run, so a click's handler can get as far as it can. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Let every continuation queued so far run to its next wait.
 *
 * Each macrotask turn drains the microtask queue behind it, so a promise chain
 * of "await the reply, then apply it" has finished by the time this returns,
 * while anything waiting on a timer of its own has not.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await tick();
}

describe("reading the list while an edit is being written", () => {
  it("does not let an older reply become the view, or the next keystroke", async () => {
    const store = draftsStore();
    const { user } = renderDrafts();
    const text = await openDraft(user);

    // The write leaves the interface and is held at the boundary, so an edit is
    // on its way to the file while everything below happens.
    const releaseSave = store.holdSave();
    await user.type(text, "one");
    await waitFor(() => {
      expect(store.backend.callsTo("draft_save")).toHaveLength(1);
    });

    // A read is asked for now. Its reply is composed from the file as it stands
    // — before the write — and held, so the write can land first.
    const releaseLoad = store.holdLoad();
    // The click is awaited, not just dispatched: the handler runs inside it, so
    // when this resolves the read has either gone out or is deliberately waiting.
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    // The write lands: the edit is on disk and nothing is queued any more.
    releaseSave();
    await waitFor(() => {
      expect(recordText(store.stored()[0])).toBe("one");
    });

    // Only now does the older reply arrive, and every continuation it sets off
    // is run before anything is asserted.
    releaseLoad();
    await flush();

    expect(
      screen.getByLabelText<HTMLInputElement>("Text").value,
      "the Draft on screen is the edit, not the bytes the read saw",
    ).toBe("one");

    // And the next keystroke persists the edit rather than the older text: the
    // read is only a hazard because of what it does to the following save.
    await user.type(screen.getByLabelText("Text"), "!");
    await waitFor(() => {
      expect(recordText(store.stored()[0])).toBe("one!");
    });
  });
});
