// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { LibraryPage } from "./LibraryPage";
import { fakeBackend, renderUi } from "../test/dom";
import { SNAPSHOT, libraryState, libraryView } from "../test/libraryState";
import { EMPTY_LIBRARY_TITLE } from "../lib/library";
import type { LibraryState } from "../hooks/useLibrary";
import type { Snapshot, SnapshotDraft } from "../lib/library";
import type { WriteResult } from "../types";

/**
 * Library's Snapshots collection is a master-detail surface.
 *
 * The list sits beside the Snapshot that is open, and everything that changes a
 * Snapshot — its name, its note, its existence, a write back to a tag — happens
 * in that pane. Selecting does not move the list and does not push the pane's
 * detail below an unrelated panel, which is what the page used to do: choosing a
 * Snapshot reflowed the page and put its controls under the whole list.
 *
 * The two empty states are the other thing this file pins down. An empty library
 * is a teaching state — there is nothing to select and nothing to look at beside
 * — while a library with Snapshots and none chosen is a pane that says what
 * choosing one would do. They are different sentences because they are different
 * situations, and showing the teaching copy over a populated library is how a
 * page tells a user to read a tag they already read.
 *
 * Both panes are asserted as siblings of one layout row, which is the structural
 * half of "beside, not below"; the rendered row itself is checked at the window
 * sizes in the verification slice.
 */

/** A 13.56 MHz Snapshot: a UID and the raw bytes, with no Identity. */
const HF_SNAPSHOT: Snapshot = {
  id: "04 A2 2B 3A 5C 6D 80",
  name: "Office door",
  note: "back gate",
  kind: "HF",
  capturedAt: new Date().toISOString(),
  writeCount: 0,
  hf: { uid: "04 A2 2B 3A 5C 6D 80", raw: "00 01 02" },
};

/** A write the reader confirmed by reading the tag back. */
const VERIFIED: WriteResult = {
  customer: 0x55,
  data32: 0x0084_8212,
  readback: {
    customer: 0x55,
    data32: 0x0084_8212,
    id: "55 00 84 82 12",
    facility: 0x84,
    card: 0x8212,
    raw: "55 00 84 82 12",
  },
  outcome: "verified",
  verified: true,
  message: null,
  confirmedCopies: 1,
  countProblem: null,
};

function state(
  snapshots: Snapshot[] = [SNAPSHOT],
  overrides: Partial<LibraryState> = {},
): LibraryState {
  return libraryState({ view: libraryView(snapshots), ...overrides });
}

function render(snapshots: Snapshot[] = [SNAPSHOT], overrides: Partial<LibraryState> = {}) {
  return renderUi(
    <LibraryPage
      connected={false}
      library={state(snapshots, overrides)}
      onChirp={() => {}}
    />,
  );
}

/** The pane beside the list: the same landmark whether or not one is chosen. */
function pane(): HTMLElement {
  return screen.getByRole("region", { name: "Snapshot detail" });
}

/** The Snapshots list. */
function list(): HTMLElement {
  return screen.getByRole("list");
}

/** One row of the list, as the control that opens it. */
function row(name: string): HTMLElement {
  return within(list()).getByRole("button", { name: new RegExp(`^${name} `) });
}

/** The name field of whatever the pane is showing. */
function nameField(name: string): HTMLInputElement {
  return within(pane()).getByRole("textbox", { name: `Name for ${name}` }) as HTMLInputElement;
}

describe("Snapshots as a list beside a detail pane", () => {
  it("puts the list and the pane in one row, with the list outside the pane", () => {
    render();

    const layout = document.querySelector('[data-layout="list-detail"]');
    expect(layout).toBeTruthy();
    expect(within(layout as HTMLElement).getByRole("list")).toBeTruthy();
    expect(
      within(layout as HTMLElement).getByRole("region", { name: "Snapshot detail" }),
    ).toBeTruthy();
    // Not stacked: the list is not part of the pane it sits beside.
    expect(within(pane()).queryByRole("list")).toBeNull();
  });

  it("opens the Snapshot that was chosen without moving the list", async () => {
    const { user } = render([SNAPSHOT, HF_SNAPSHOT]);

    // Something is open on arrival: an empty half of the window wastes the width
    // the minimum size has to give, and leaves the pane's actions two clicks away.
    expect(nameField(SNAPSHOT.name).value).toBe(SNAPSHOT.name);
    const before = within(list()).getAllByRole("listitem").map((row) => row.textContent);

    await user.click(row(HF_SNAPSHOT.name));

    expect(nameField(HF_SNAPSHOT.name).value).toBe(HF_SNAPSHOT.name);
    // The pane changed; the list did not.
    expect(within(list()).getAllByRole("listitem").map((row) => row.textContent)).toEqual(before);
    expect(within(pane()).queryByRole("button", { name: `Delete ${SNAPSHOT.name}` })).toBeNull();
  });

  it("leaves the search and the sort out until there is more than one Snapshot", () => {
    render();

    expect(screen.queryByRole("textbox", { name: "Search Snapshots" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Newest first" })).toBeNull();
  });

  it("offers the search and both orders once there is more than one Snapshot", () => {
    render([SNAPSHOT, HF_SNAPSHOT]);

    expect(screen.getByRole("textbox", { name: "Search Snapshots" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Newest first" })).toBeTruthy();
  });
});

/**
 * The library store seam: a rename or a note edit has to reach `edit` with the
 * Snapshot the pane is showing, and nothing may be written before the user says
 * so — the pane's fields are a draft, not the stored Snapshot.
 */
describe("renaming and noting from the detail pane", () => {
  it("writes nothing until Save, then writes that Snapshot's name and note", async () => {
    const edit = vi.fn(async (_id: string, _draft: SnapshotDraft) => {});
    const { user } = render([SNAPSHOT], { edit });

    const note = within(pane()).getByRole("textbox", { name: `Note for ${SNAPSHOT.name}` });
    await user.type(note, "spare for gate 3");

    // Typing is a draft: the library file has not been touched.
    expect(edit).not.toHaveBeenCalled();

    await user.click(within(pane()).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(edit).toHaveBeenCalledTimes(1);
    });
    expect(edit.mock.calls).toEqual([
      [SNAPSHOT.id, { name: SNAPSHOT.name, note: "spare for gate 3" }],
    ]);
  });

  it("puts the stored note back when the change is reverted", async () => {
    const edit = vi.fn(async () => {});
    const { user } = render([{ ...SNAPSHOT, note: "already here" }], { edit });

    const note = within(pane()).getByRole("textbox", { name: `Note for ${SNAPSHOT.name}` });
    await user.clear(note);
    await user.type(note, "typed over");
    await user.click(within(pane()).getByRole("button", { name: "Revert" }));

    expect(
      (within(pane()).getByRole("textbox", { name: `Note for ${SNAPSHOT.name}` }) as
        HTMLTextAreaElement).value,
    ).toBe("already here");
    expect(edit).not.toHaveBeenCalled();
  });

  it("keeps the name and the note off when the library file cannot be written", () => {
    render([SNAPSHOT], {
      view: {
        ...libraryView(),
        problem: { kind: "corrupt", message: "The file is not JSON.", detail: null },
      },
    });

    expect(nameField(SNAPSHOT.name).disabled).toBe(true);
    expect(
      (within(pane()).getByRole("textbox", { name: `Note for ${SNAPSHOT.name}` }) as
        HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(
      (within(pane()).getByRole("button", { name: `Delete ${SNAPSHOT.name}` }) as
        HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

/**
 * The confirmation gate, from its new home: the pane. The accessible name and
 * the danger variant are the same ones the row carried, so the gate's own tests
 * still drive the same control.
 */
describe("deleting from the detail pane", () => {
  it("asks before it removes, and carries the danger variant on both controls", async () => {
    const remove = vi.fn(async (_id: string) => {});
    const { user } = render([SNAPSHOT], { remove });

    const trash = within(pane()).getByRole("button", { name: `Delete ${SNAPSHOT.name}` });
    expect(trash.getAttribute("data-variant")).toBe("danger");

    await user.click(trash);

    const confirm = within(pane()).getByRole("button", { name: "Delete permanently" });
    expect(confirm.getAttribute("data-variant")).toBe("danger");

    await user.click(confirm);

    await waitFor(() => {
      expect(remove.mock.calls).toEqual([[SNAPSHOT.id]]);
    });
  });
});

describe("writing a Snapshot back to a tag", () => {
  it("writes the Snapshot in the pane, reports the outcome and counts the copy", async () => {
    const backend = fakeBackend({ lf_write: () => VERIFIED });
    const onChirp = vi.fn();
    const reload = vi.fn(async () => {});
    const { user } = renderUi(
      <LibraryPage connected library={state([SNAPSHOT], { reload })} onChirp={onChirp} />,
    );

    await user.click(within(pane()).getByRole("button", { name: "Write to tag" }));

    await waitFor(() => {
      expect(backend.callsTo("lf_write")).toHaveLength(1);
    });
    // The Identity of the Snapshot in the pane, not of a row that happened to be
    // clicked: the write command is the pane's, and it names what it writes.
    expect(backend.callsTo("lf_write")[0].args).toEqual({
      customer: SNAPSHOT.identity?.customer,
      data32: SNAPSHOT.identity?.data32,
    });
    await waitFor(() => {
      expect(onChirp).toHaveBeenCalled();
    });
    expect(reload).toHaveBeenCalled();
    expect(within(pane()).getByText(/^Verified/)).toBeTruthy();
  });

  it("offers no write for a 13.56 MHz Snapshot", () => {
    render([HF_SNAPSHOT]);

    expect(within(pane()).queryByRole("button", { name: "Write to tag" })).toBeNull();
  });
});

/**
 * Records belong to a 13.56 MHz message. A 125 kHz Snapshot has no such thing,
 * so it has no such area; a 13.56 MHz Snapshot has the area and, until saving a
 * read fills it, says the Records are absent rather than that they are loading —
 * a library on disk is not going to finish arriving.
 */
describe("Records in the detail pane", () => {
  it("shows no Records area at all for a 125 kHz Snapshot", () => {
    render([SNAPSHOT]);

    expect(within(pane()).queryByText("Records")).toBeNull();
  });

  it("says none, never loading, for a 13.56 MHz Snapshot", () => {
    render([HF_SNAPSHOT]);

    expect(within(pane()).getByText("Records")).toBeTruthy();
    expect(within(pane()).getByText("none")).toBeTruthy();
    expect(within(pane()).queryByText(/loading/i)).toBeNull();
  });
});

/**
 * The two empty states. An empty library has nothing to show beside it and says
 * what a Snapshot is; a library with Snapshots and none chosen keeps the list
 * and says what choosing one would do.
 */
describe("an empty library is not the same state as nothing selected", () => {
  it("teaches what a Snapshot is when the library is empty", () => {
    render([]);

    expect(screen.getByText(EMPTY_LIBRARY_TITLE)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("region", { name: "Snapshot detail" })).toBeNull();
  });

  it("prompts in the pane when there are Snapshots and none is chosen", async () => {
    const { user } = render([SNAPSHOT, HF_SNAPSHOT]);

    // Choosing the open Snapshot again closes it: the pane is not stuck open.
    await user.click(row(SNAPSHOT.name));

    expect(within(pane()).getByText("Nothing selected")).toBeTruthy();
    // The teaching copy belongs to the empty library, not to this.
    expect(screen.queryByText(EMPTY_LIBRARY_TITLE)).toBeNull();
    expect(within(pane()).queryByRole("textbox", { name: /^Name for / })).toBeNull();
    // The list is still there to choose from.
    expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
  });
});

/**
 * Five hundred Snapshots, which is what a year of bench work looks like.
 *
 * Every row is in the list and one can be opened, and the whole exchange —
 * render, then open a Snapshot four hundred rows down — completes in well under
 * the budget. The list scrolls inside its own column, so the page never becomes
 * twenty-two thousand pixels tall to move the pane out of reach.
 */
describe("a library of five hundred Snapshots", () => {
  it("stays interactive", async () => {
    const many: Snapshot[] = Array.from({ length: 500 }, (_, i) => ({
      ...SNAPSHOT,
      id: `55 00 ${String(i + 1).padStart(2, "0")} 00 00`,
      name: `Snapshot ${i + 1}`,
      note: "",
    }));

    const started = performance.now();
    const { user } = render(many);

    expect(within(list()).getAllByRole("listitem")).toHaveLength(500);

    await user.click(row("Snapshot 400"));
    expect(nameField("Snapshot 400").value).toBe("Snapshot 400");

    expect(performance.now() - started).toBeLessThan(4000);
  });
});
