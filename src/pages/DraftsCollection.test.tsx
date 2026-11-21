// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { DraftsCollection } from "./DraftsCollection";
import { LibraryPage } from "./LibraryPage";
import { DraftsProvider } from "../components/DraftsProvider";
import { SNAPSHOT, libraryState } from "../test/libraryState";
import {
  fakeBackend,
  renderUi,
  type Backend,
  type CommandAnswer,
  type Ui,
} from "../test/dom";
import { toastStore } from "../lib/toastStore";
import { draftMessageHex, type NdefPreview } from "../lib/tagWrite";
import type { Draft, DraftRecord, DraftsView } from "../lib/drafts";
import type { LibraryProblem } from "../lib/library";
import type { NdefTagSnapshot } from "../types";

/**
 * Gate 2 of 8: deleting a Draft.
 *
 * A Snapshot can be read off its Tag again; a Draft was authored and never lived
 * on a Tag, so nothing can regenerate it. Draft delete is therefore the one
 * removal in the app with no way back, and it asks first: the pane's Delete
 * control opens a confirmation naming the Draft, and the removal happens from
 * that confirmation's button, not from the Delete control.
 *
 * The three tests below are the pair the defect section asks for, plus the
 * narrowness the ticket adds. Dismissing must remove nothing (which fails if the
 * removal is wired straight to the control); confirming must remove that Draft
 * and no other; and the Draft that was dismissed must still be there afterwards.
 * Eight gates is D5's number, and it is true only because this one exists —
 * ticket 01 proved the seven that already had a confirmation and could not prove
 * a gate that was not there (see the correction note in D5).
 *
 * The store is reached through `invoke`, like every other persisted call, so the
 * fake backend stands at that boundary and the real hook runs unmodified. This
 * file also covers the rest of what Drafts owns now that it is a Collection of
 * Library rather than a page of its own: its Records editor, the inline report of
 * a Record that cannot be encoded, the way out to a Tag, and the absence of the
 * panel that used to read a Tag into a Draft.
 */

const DRAFT: Draft = {
  id: "draft-1",
  name: "Loading bay sign",
  updatedAt: new Date().toISOString(),
  records: [],
};

const OTHER: Draft = {
  id: "draft-2",
  name: "Canteen sign",
  updatedAt: new Date().toISOString(),
  records: [],
};

const THIRD: Draft = {
  id: "draft-3",
  name: "Gate three sign",
  updatedAt: new Date().toISOString(),
  records: [],
};

function view(
  drafts: Draft[],
  problem: LibraryProblem | null = null,
  migrationWarning: string | null = null,
): DraftsView {
  return { drafts, problem, migrationWarning };
}

/**
 * The Collection as the app mounts it: inside the provider that owns the queue
 * and the window-close guard. The Collection itself takes no store, because
 * there is one queue for the app and not one per Collection.
 */
function renderCollection(
  drafts: Draft[] = [DRAFT],
  overrides: Record<string, CommandAnswer> = {},
  connected = false,
): { backend: Backend; ui: Ui; stored: () => Draft[] } {
  let stored = drafts;
  const backend = fakeBackend({
    drafts_load: () => view(stored),
    // A store, not a stub: a save writes the Draft it was sent, so a test can
    // look at what reached the file.
    draft_save: (args) => {
      const draft = structuredClone(args.draft as Draft);
      stored = stored.map((held) => (held.id === draft.id ? draft : held));
      return view(stored);
    },
    draft_delete: (args) => {
      stored = stored.filter((held) => held.id !== args.id);
      return view(stored);
    },
    ...overrides,
  });
  const ui = renderUi(
    <DraftsProvider>
      <DraftsCollection connected={connected} />
    </DraftsProvider>,
  );
  return { backend, ui, stored: () => stored };
}

/** The Draft list: the column the editor sits beside. */
function draftList(): HTMLElement {
  return screen.getByRole("list", { name: "Drafts" });
}

/**
 * The pane beside the Draft list, once the list has been read.
 *
 * Awaited rather than fetched: the first Draft opens on arrival, and arrival is
 * a read of the library file. Every test that asserts about the editor is
 * therefore asserting about the state the file produced, not about the frame
 * before it.
 */
function pane(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Draft detail" });
}

/** The Draft the interface last handed the store to write. */
function savedDraft(backend: Backend): Draft {
  const saves = backend.callsTo("draft_save");
  return saves[saves.length - 1]?.args.draft as Draft;
}

/** Every Draft on screen, by name, in the order the list renders them. */
function listedNames(): string[] {
  return within(draftList())
    .getAllByRole("listitem")
    .map((row) => {
      const control = within(row).getByRole("button");
      return (control.getAttribute("aria-label") ?? "").replace(/ — .*$/, "");
    });
}

/** Open the Draft named `name` in the pane, the way a user does. */
async function openDraft(user: UserEvent, name: string): Promise<void> {
  const list = await screen.findByRole("list", { name: "Drafts" });
  await user.click(within(list).getByRole("button", { name: new RegExp(`^${name} —`) }));
}

afterEach(() => {
  toastStore.clear();
});

describe("deleting a Draft", () => {
  it("asks before it removes anything, and keeping the Draft removes nothing", async () => {
    const { backend, ui } = renderCollection([DRAFT, OTHER]);

    await ui.user.click(
      await within(await pane()).findByRole("button", { name: `Delete ${DRAFT.name}` }),
    );

    // The confirmation is on screen, and it names the Draft it is about to
    // remove. While it is open the pane's own fields are replaced by it, so the
    // name has nowhere else to come from.
    const prompt = screen.getByText(/Delete\s+permanently\?/);
    expect(prompt.textContent).toContain(DRAFT.name);
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    // The control that destroys the Draft asks for the `danger` variant, rather
    // than carrying a class that merely looks like it. The variant is read from
    // the attribute the button renders for it, so a hand-rolled class — including
    // one that would be almost invisible, `border-err/5` — cannot satisfy this.
    expect(confirm.dataset.variant).toBe("danger");

    await ui.user.click(screen.getByRole("button", { name: "Keep" }));

    // Dismissed: the store was never asked to remove anything, and both Drafts
    // are still listed exactly as they were.
    expect(backend.callsTo("draft_delete")).toHaveLength(0);
    expect(listedNames()).toEqual([DRAFT.name, OTHER.name]);
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
    // And the editor is back, with nothing removed from it.
    expect(within(await pane()).getByRole("button", { name: `Delete ${DRAFT.name}` })).toBeTruthy();
  });

  it("removes that Draft through the store when the confirmation is confirmed", async () => {
    const { backend, ui } = renderCollection([DRAFT, OTHER]);

    await ui.user.click(
      await within(await pane()).findByRole("button", { name: `Delete ${DRAFT.name}` }),
    );
    await ui.user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(backend.callsTo("draft_delete")).toHaveLength(1);
    });
    // That Draft, and no other.
    expect(backend.callsTo("draft_delete")[0]?.args).toEqual({ id: DRAFT.id });
  });

  it("leaves every other Draft in place when one is confirmed away", async () => {
    const { backend, ui } = renderCollection([DRAFT, OTHER, THIRD]);

    // The deletion is about the Draft the pane is showing, so open that one
    // first: the confirmation can only ever name what the editor has open.
    await openDraft(ui.user, OTHER.name);
    await ui.user.click(within(await pane()).getByRole("button", { name: `Delete ${OTHER.name}` }));
    await ui.user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(listedNames()).toEqual([DRAFT.name, THIRD.name]);
    });
    // One removal was asked for, and it named the Draft the pane was showing.
    expect(backend.callsTo("draft_delete").map((call) => call.args)).toEqual([{ id: OTHER.id }]);
  });
});

/**
 * The list is read once on the way up, not once per reader.
 *
 * The queue is the app's — it lives above the navigation — so the list is
 * already read when the app starts. Opening the Drafts Collection reads it again
 * because the list can change elsewhere (an import adds Drafts), and that is the
 * reason it must be fresh when the user gets there. At launch those two are the
 * same question asked in the same commit, so they are one read.
 */
describe("reading the list", () => {
  it("reads it once when the app opens, not once per reader", async () => {
    const { backend } = renderCollection([DRAFT]);

    expect(await screen.findByText(DRAFT.name)).toBeTruthy();
    // Both readers ask in the same commit, so a second read would already have
    // been sent by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backend.callsTo("drafts_load")).toHaveLength(1);
  });

  it("reads it again when the collection is opened, so a Draft added elsewhere is there", async () => {
    // The reason the Collection reads at all: the list can change while the page
    // is on Snapshots — an import adds Drafts — so opening Drafts must not show
    // what the queue read at launch.
    let stored = [DRAFT];
    const backend = fakeBackend({ drafts_load: () => view(stored) });
    const { user } = renderUi(
      <DraftsProvider>
        <LibraryPage connected={false} library={libraryState()} onChirp={() => {}} />
      </DraftsProvider>,
    );
    await waitFor(() => {
      expect(backend.callsTo("drafts_load")).toHaveLength(1);
    });

    // Something else wrote a Draft to the library while Library was showing
    // Snapshots.
    stored = [DRAFT, OTHER];
    await user.click(screen.getByRole("button", { name: "Drafts" }));

    expect(await screen.findByText(OTHER.name)).toBeTruthy();
    expect(backend.callsTo("drafts_load")).toHaveLength(2);
  });
});

/**
 * The library file cannot be written: Drafts and Snapshots live in one file, so
 * one lock covers both, and it is reported the same way in both Collections.
 *
 * This is the same defect class the migration warning had — the same state of
 * the same file rendered twice, and the two copies drifted — so the Collection
 * renders `LibraryProblemBanner` and the assertions here are the treatment it
 * must have: what the file is, the store's reason, the store's detail, and saving
 * turned off. "Turned off" means every control that writes, in both Collections.
 */
describe("a library that cannot be written", () => {
  const DETAIL = "/Users/ada/Library/Application Support/pm4-studio/library.json";
  const PROBLEM: LibraryProblem = {
    kind: "newerVersion",
    message: "The file claims schema 3, which this build does not write.",
    detail: DETAIL,
  };

  it("reports it with the store's reason and detail, and turns saving off", async () => {
    renderCollection([DRAFT], { drafts_load: () => view([DRAFT], PROBLEM) });

    expect(await screen.findByText(/newer version of PM4 Studio/)).toBeTruthy();
    expect(screen.getByText(/claims schema 3/)).toBeTruthy();
    // The detail the store reported, which the old Drafts page used to drop.
    expect(screen.getByText(DETAIL)).toBeTruthy();

    const create = screen.getByRole("button", { name: "New Draft" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables every control that writes to the file, in the Drafts collection", async () => {
    const withRecord: Draft = {
      ...DRAFT,
      records: [{ kind: "text", fields: { language: "en", text: "Hello" } }],
    };
    renderCollection([withRecord], { drafts_load: () => view([withRecord], PROBLEM) });

    await within(await pane()).findByRole("button", { name: `Delete ${DRAFT.name}` });

    const controls: HTMLButtonElement[] = [
      screen.getByRole("button", { name: "New Draft" }),
      within(await pane()).getByRole("button", { name: `Delete ${DRAFT.name}` }),
      within(await pane()).getByRole("button", { name: "Add Record" }),
      // A Record that is already in the Draft: reordering and deleting it are
      // file writes as much as adding one is.
      within(await pane()).getByRole("button", { name: "Move up" }),
      within(await pane()).getByRole("button", { name: "Move down" }),
      within(await pane()).getByRole("button", { name: "Delete Record" }),
      // The way out to a Tag is not one of them: it is asserted below.
    ];
    for (const control of controls) expect(control.disabled).toBe(true);

    // And the fields themselves: a control that is enabled but cannot save is
    // the same broken promise in a different place.
    expect(
      (within(await pane()).getByRole("textbox", { name: `Name for ${DRAFT.name}` }) as
        HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (within(await pane()).getByRole("textbox", { name: "Text" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: "Name of the new Draft" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (within(await pane()).getByRole("combobox", { name: "Record type to add" }) as
        HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it("leaves the way out to a Tag alone, because a Tag write is not a file write", async () => {
    // The lock is about the library file: the app will not write a file it could
    // not read. Writing the Draft on screen to a Tag never touches that file, and
    // refusing it would strand a user whose Draft is open in front of them and
    // whose library is unreadable. This is the one control in either Collection
    // the lock does not reach, so it is asserted rather than assumed.
    const withRecord: Draft = {
      ...DRAFT,
      records: [{ kind: "text", fields: { language: "en", text: "Hello" } }],
    };
    renderCollection([withRecord], { drafts_load: () => view([withRecord], PROBLEM) }, true);

    const check = (await within(await pane()).findByRole("button", {
      name: "Check tag",
    })) as HTMLButtonElement;
    expect(check.disabled).toBe(false);
  });

  it("disables every control that writes in the Snapshots collection too", () => {
    fakeBackend();
    renderUi(
      <DraftsProvider>
        <LibraryPage
          connected={false}
          library={libraryState({
            view: {
              ...libraryState().view!,
              problem: PROBLEM,
            },
          })}
          onChirp={() => {}}
        />
      </DraftsProvider>,
    );

    expect(
      (screen.getByRole("button", { name: `Delete ${SNAPSHOT.name}` }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: `Name for ${SNAPSHOT.name}` }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });
});

/**
 * Ticket 04 / ADR 0005: a version 1 library is lifted on open, and a lift that
 * cannot be written is reported. The Drafts are the reason the version exists —
 * they are the collection an older build would have dropped — so the Collection
 * says when the file still carries the older claim, and stays usable.
 */
describe("a library lifted from an older schema", () => {
  const WARNING =
    "This library was written for schema 1 and has been read as schema 2. It could not be rewritten: permission denied. Everything in it is open and usable, and saving will correct the file.";

  it("shows every Draft and reports the lift that could not be written", async () => {
    renderCollection([DRAFT], { drafts_load: () => view([DRAFT], null, WARNING) });

    expect(await screen.findByText(DRAFT.name)).toBeTruthy();
    expect(screen.getByText(/could not be rewritten/)).toBeTruthy();
    // A warning, not a lock: the file was read whole, so saving stays on.
    const create = screen.getByRole("button", { name: "New Draft" });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });

  it("says nothing when the lift was written", async () => {
    renderCollection([DRAFT]);

    expect(await screen.findByText(DRAFT.name)).toBeTruthy();
    expect(screen.queryByText(/could not be rewritten/)).toBeNull();
  });
});

/**
 * The Records editor, beside the list.
 *
 * Everything that changes a Draft is in the pane: the name, the Records in
 * order, and the control that adds one. The encoded size of each Record and the
 * total the Draft would write are shown against capacity — and where capacity is
 * not known, that is stated rather than guessed.
 */
describe("editing the Records of a Draft", () => {
  const HELLO: DraftRecord = { kind: "text", fields: { language: "en", text: "Hello" } };

  it("shows each Record's size and the Draft's total against capacity", async () => {
    renderCollection([{ ...DRAFT, records: [HELLO] }]);

    await within(await pane()).findByRole("textbox", { name: "Text" });

    // Per Record: the kind, the encoded size and the value that identifies it.
    const records = within(await pane()).getByRole("list", { name: "Records in this Draft" });
    expect(within(records).getByText("12 bytes")).toBeTruthy();
    expect(within(records).getByText("Hello")).toBeTruthy();
    // Total: 12 bytes, which is what a Write would put on a Tag.
    expect(within(await pane()).getByText("1 Record · 12 bytes")).toBeTruthy();
    // And against capacity, which a Draft with no Tag in hand does not have.
    expect(within(await pane()).getByText(/not compared against it/)).toBeTruthy();
  });

  it("adds a Record of the kind the add control names", async () => {
    const { backend, ui } = renderCollection([DRAFT]);

    await ui.user.selectOptions(
      await within(await pane()).findByRole("combobox", { name: "Record type to add" }),
      "url",
    );
    await ui.user.click(within(await pane()).getByRole("button", { name: "Add Record" }));

    const url = await within(await pane()).findByRole("textbox", { name: "URL" });
    await ui.user.type(url, "https://example.com");

    // The Record is in the Draft the store is given, not only on screen.
    await waitFor(() => {
      expect(savedDraft(backend).records).toEqual([
        { kind: "url", fields: { url: "https://example.com" } },
      ]);
    });
  });

  it("edits a Record in place and writes the edit", async () => {
    const { backend, ui } = renderCollection([{ ...DRAFT, records: [HELLO] }]);

    const text = await within(await pane()).findByRole("textbox", { name: "Text" });
    await ui.user.clear(text);
    await ui.user.type(text, "Loading bay 3");

    await waitFor(() => {
      expect(savedDraft(backend).records).toEqual([
        { kind: "text", fields: { language: "en", text: "Loading bay 3" } },
      ]);
    });
  });

  it("reorders the Records, because the order is what a Tag receives", async () => {
    const URL_RECORD: DraftRecord = { kind: "url", fields: { url: "https://example.com" } };
    const { backend, ui } = renderCollection([{ ...DRAFT, records: [HELLO, URL_RECORD] }]);

    await within(await pane()).findByRole("textbox", { name: "URL" });
    // The second Record's own control: moving it up is the only way to say the
    // URL comes first.
    const moveUps = within(await pane()).getAllByRole("button", { name: "Move up" });
    await ui.user.click(moveUps[1] as HTMLElement);

    await waitFor(() => {
      expect(savedDraft(backend).records).toEqual([URL_RECORD, HELLO]);
    });
  });

  it("deletes one Record and leaves the others", async () => {
    const URL_RECORD: DraftRecord = { kind: "url", fields: { url: "https://example.com" } };
    const { backend, ui } = renderCollection([{ ...DRAFT, records: [HELLO, URL_RECORD] }]);

    await within(await pane()).findByRole("textbox", { name: "URL" });
    await ui.user.click(within(await pane()).getAllByRole("button", { name: "Delete Record" })[0] as HTMLElement);

    await waitFor(() => {
      expect(savedDraft(backend).records).toEqual([URL_RECORD]);
    });
    // The remaining Record is still on screen to edit.
    expect(within(await pane()).getByRole("textbox", { name: "URL" })).toBeTruthy();
  });

  it("renames the Draft from the pane", async () => {
    const { backend, ui } = renderCollection([DRAFT]);

    const name = await within(await pane()).findByRole("textbox", { name: `Name for ${DRAFT.name}` });
    await ui.user.clear(name);
    await ui.user.type(name, "Loading bay 3");

    await waitFor(() => {
      expect(savedDraft(backend).name).toBe("Loading bay 3");
    });
    // The list follows the name, because the list is the Drafts that exist.
    expect(within(draftList()).getByRole("button", { name: /^Loading bay 3 —/ })).toBeTruthy();
  });
});

/**
 * A Record that cannot be encoded is a condition of the Draft, not an event.
 *
 * It says what is wrong next to the field it is about, and it stays there: the
 * app has a toast channel now, and a toast for a half-typed Wi-Fi Record would
 * be a message about a state rather than about something that happened. The
 * total is withheld rather than guessed, and the Draft is not thrown away.
 */
describe("a Record this build cannot encode", () => {
  it("explains itself inline, keeps the Draft, and does not toast", async () => {
    const broken: Draft = {
      ...DRAFT,
      records: [{ kind: "wifi", fields: { ssid: "", networkKey: "", auth: "wpa2-personal", encryption: "aes" } }],
    };
    renderCollection([broken]);

    expect(await within(await pane()).findByText("A Wi-Fi Record needs an SSID.")).toBeTruthy();
    // The total is unavailable, and the reason is stated rather than a number.
    expect(within(await pane()).getByText(/The total is unavailable/)).toBeTruthy();
    expect(within(await pane()).getByText("size unavailable")).toBeTruthy();
    // Still editable: the Draft was not dropped for being unencodable.
    expect(within(await pane()).getByRole("textbox", { name: "Wi-Fi SSID" })).toBeTruthy();
    // And nothing was announced as an outcome, because nothing happened.
    expect(toastStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

/**
 * The way out: writing the whole Draft to a 13.56 MHz Tag.
 *
 * The flow is unchanged — check the Tag, read what the write would replace,
 * confirm, then read back — and this proves it is reachable from the editor
 * rather than that it works, which `WriteDraftToTag.test.tsx` owns.
 */
describe("writing a Draft to a tag", () => {
  const RECORDS: DraftRecord[] = [{ kind: "text", fields: { language: "en", text: "Loading bay" } }];
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
    requiredBytes: draftMessageHex(RECORDS).split(" ").length,
    capacityBytes: TAG.capacityBytes,
    fits: true,
    refusal: null,
  };

  it("is reachable from the editor, and still asks before it writes", async () => {
    const { backend, ui } = renderCollection(
      [{ ...DRAFT, records: RECORDS }],
      { hf_ndef_preview: () => PREVIEW },
      true,
    );

    await within(await pane()).findByRole("textbox", { name: "Text" });
    // The control is inside the Draft's pane, beside its Records.
    const check = within(await pane()).getByRole("button", { name: "Check tag" });
    await ui.user.click(check);

    expect(await within(await pane()).findByText("Replace the message on the tag with this Draft?")).toBeTruthy();
    expect(backend.callsTo("hf_ndef_write")).toHaveLength(0);
    expect(within(await pane()).getByRole("button", { name: "Write to tag" })).toBeTruthy();
  });
});

/**
 * The panel that read a Tag into a Draft is gone, and gone rather than moved.
 *
 * It existed so Drafts had the app's only NDEF reading surface, which is why
 * NDEF looked like it lived in a tab of its own. Reading a 13.56 MHz Tag produces
 * the message inline now, and Edit as Draft on that readout is the way in
 * (ticket 16), so the Drafts Collection offers no reading control at all.
 */
describe("the read-a-tag-into-a-draft panel", () => {
  it("is not part of the Drafts collection", async () => {
    renderCollection([DRAFT]);

    await within(await pane()).findByRole("button", { name: `Delete ${DRAFT.name}` });

    expect(screen.queryByRole("button", { name: /read (a )?(tag|the tag)/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "From a tag" })).toBeNull();
    expect(screen.queryByText(/read tag into a draft/i)).toBeNull();
  });
});
