// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { LibraryPage } from "./LibraryPage";
import { DraftsProvider } from "../components/DraftsProvider";
import { fakeBackend, renderUi } from "../test/dom";
import { SNAPSHOT, libraryState } from "../test/libraryState";
import { handOffDraft } from "../lib/draftHandoff";
import type { Draft, DraftsView } from "../lib/drafts";

/**
 * Library holds both Collections, and they are two Collections of one page.
 *
 * A Draft is a message under construction and a Snapshot is a record of a read,
 * so they are never one list. What they share is the page and the layout: the
 * Collection switch above, a list on the left, the chosen item's editor beside
 * it. Drafts stopped being a destination when the sidebar became five, and this
 * switch is what keeps every saved Draft reachable.
 *
 * The seam this file proves is the switch: which Collection is active, and that
 * one Collection's chosen item never appears in the other. Both halves are
 * things the DOM can answer, so neither is a claim about intent — a page that
 * mounted both Collections, or that let a Snapshot's editor stand in for a
 * Draft's, fails here.
 */

/** A Draft with one Record, so its editor has something of its own to show. */
const DRAFT: Draft = {
  id: "draft-1",
  name: "Loading bay sign",
  updatedAt: "2026-11-22T09:00:00.000Z",
  records: [{ kind: "text", fields: { language: "en", text: "Deliveries to bay 3" } }],
};

function draftsView(drafts: Draft[]): DraftsView {
  return { drafts, problem: null, migrationWarning: null };
}

/** The page as the app mounts it: Library, inside the provider Drafts needs. */
function renderLibrary(drafts: Draft[] = [DRAFT]) {
  const backend = fakeBackend({
    // Drafts are read through the same library file, on their own command.
    drafts_load: () => draftsView(drafts),
  });
  const ui = renderUi(
    <DraftsProvider>
      <LibraryPage connected={false} library={libraryState()} onChirp={() => {}} />
    </DraftsProvider>,
  );
  return { backend, ui };
}

/** The Collection switch, which is how a user moves between the two. */
function collectionSwitch(): HTMLElement {
  return screen.getByRole("group", { name: "Collection" });
}

/** Which Collection the switch says is current. */
function currentCollection(): string | null {
  const pressed = within(collectionSwitch())
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true");
  expect(pressed).toHaveLength(1);
  return pressed[0]?.textContent ?? null;
}

/** The Draft list: the column the editor sits beside. */
function draftList(): HTMLElement {
  return screen.getByRole("list", { name: "Drafts" });
}

/** The pane beside the Draft list. */
function draftPane(): HTMLElement {
  return screen.getByRole("region", { name: "Draft detail" });
}

describe("Library's two collections", () => {
  it("opens on Snapshots, and says which collection is current", () => {
    renderLibrary();

    expect(currentCollection()).toBe("Snapshots");
    expect(screen.getByRole("heading", { name: "Snapshots" })).toBeTruthy();
  });

  it("reaches Drafts in one click, as the second collection of the same page", async () => {
    const { ui } = renderLibrary();

    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Drafts" }));

    // The Drafts that are on disk, under a heading that names the collection.
    expect(await screen.findByRole("heading", { name: "Drafts" })).toBeTruthy();
    expect(within(draftList()).getByRole("button", { name: /^Loading bay sign — 1 Record$/ })).toBeTruthy();
    expect(currentCollection()).toBe("Drafts");
    // One collection at a time: the Snapshots are not underneath it.
    expect(screen.queryByRole("heading", { name: "Snapshots" })).toBeNull();
  });

  it("gives Drafts the same list and detail shape as Snapshots", async () => {
    const { ui } = renderLibrary();

    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Drafts" }));

    const layout = document.querySelector('[data-layout="list-detail"]');
    expect(layout).toBeTruthy();
    // Both halves are in the one layout row, and the list is not part of the
    // pane it sits beside.
    expect(within(layout as HTMLElement).getByRole("list", { name: "Drafts" })).toBeTruthy();
    expect(within(layout as HTMLElement).getByRole("region", { name: "Draft detail" })).toBeTruthy();
    expect(within(draftPane()).queryByRole("list", { name: "Drafts" })).toBeNull();

    // The Records editor is beside the list, never under it: the pane's fields
    // are the Draft's, and the list column holds no field at all.
    expect(within(draftPane()).getByRole("textbox", { name: "Text" })).toBeTruthy();
    expect(within(draftList()).queryByRole("textbox")).toBeNull();
  });

  it("comes back to Snapshots without losing the switch", async () => {
    const { ui } = renderLibrary();

    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Drafts" }));
    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Snapshots" }));

    // The Snapshots content is back, and the switch still names both collections.
    expect(screen.getByRole("heading", { name: "Snapshots" })).toBeTruthy();
    expect(currentCollection()).toBe("Snapshots");
    expect(within(collectionSwitch()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Snapshots",
      "Drafts",
    ]);
  });
});

/**
 * One collection's chosen item never appears in the other.
 *
 * A Snapshot's editor and a Draft's editor look alike — a name field, a place
 * for Records — so the failure this catches is not a crash but a substitution:
 * the pane carrying the wrong collection's subject, or the two collections both
 * mounted with one hidden only to the eye. Every assertion below is about what
 * is *not* on screen while a collection is active.
 */
describe("each collection keeps its own selection", () => {
  it("shows one collection's subject at a time, and never the other's", async () => {
    const { ui } = renderLibrary();

    // Snapshots on arrival: the Snapshot is open in its own pane.
    const snapshotPane = screen.getByRole("region", { name: "Snapshot detail" });
    expect(
      within(snapshotPane).getByRole("textbox", { name: `Name for ${SNAPSHOT.name}` }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Draft detail" })).toBeNull();
    expect(screen.queryByText(DRAFT.name)).toBeNull();

    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Drafts" }));

    // Drafts now: the Draft that is open is the pane's subject, with its own
    // name field and its own Records — and nothing of the Snapshot is left.
    const pane = draftPane();
    expect(
      (within(pane).getByRole("textbox", { name: `Name for ${DRAFT.name}` }) as HTMLInputElement)
        .value,
    ).toBe(DRAFT.name);
    expect(
      (within(pane).getByRole("textbox", { name: "Text" }) as HTMLInputElement).value,
    ).toBe("Deliveries to bay 3");
    expect(screen.queryByRole("region", { name: "Snapshot detail" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: `Name for ${SNAPSHOT.name}` })).toBeNull();
    expect(screen.queryByText(SNAPSHOT.name)).toBeNull();
    expect(screen.queryByText(SNAPSHOT.id)).toBeNull();

    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Snapshots" }));

    // And back: the Snapshot's pane is the one on screen, with the Draft's
    // editor gone rather than merely hidden.
    expect(screen.getByRole("region", { name: "Snapshot detail" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Draft detail" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: `Name for ${DRAFT.name}` })).toBeNull();
    expect(screen.queryByText("Deliveries to bay 3")).toBeNull();
  });

  it("opens the chosen Draft in the pane, beside the list rather than below it", async () => {
    const other: Draft = { ...DRAFT, id: "draft-2", name: "Canteen sign", records: [] };
    const { ui } = renderLibrary([DRAFT, other]);

    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Drafts" }));
    await screen.findByRole("heading", { name: "Drafts" });

    await ui.user.click(
      within(draftList()).getByRole("button", { name: /^Canteen sign — 0 Records$/ }),
    );

    // The pane follows the choice, and the list is untouched.
    expect(
      (within(draftPane()).getByRole("textbox", { name: "Name for Canteen sign" }) as
        HTMLInputElement).value,
    ).toBe("Canteen sign");
    expect(within(draftList()).getAllByRole("listitem")).toHaveLength(2);
    // A Draft with no Records says so, in the pane, rather than showing the
    // other Draft's Record editor.
    expect(within(draftPane()).queryByRole("textbox", { name: "Text" })).toBeNull();
  });
});

/**
 * A Draft handed over from a reading.
 *
 * Ticket 16's action lives on the 13.56 MHz readout and the Collection switch
 * lives here, so the two are joined by one piece of cross-page intent: the shell
 * hands the new Draft's id to Library and changes destination. What this file
 * proves is the half that owns the switch — that an arriving handoff lands the
 * page in the Drafts collection, on the Draft it names rather than on whichever
 * Draft happens to be first, and that the handoff is spent by that arrival so
 * the next visit to Library opens where a visit has always opened.
 *
 * The failure this catches is a page that arrives in the wrong collection, or in
 * the right one showing the wrong Draft — which would leave the user editing the
 * first Draft in the list while believing they are editing what they just read.
 */
describe("a Draft handed over from a reading", () => {
  it("arrives in the Drafts collection, on that Draft rather than the first in the list", async () => {
    const handed = { ...DRAFT, id: "draft-handed", name: "Handed over" };
    handOffDraft(handed.id);

    renderLibrary([DRAFT, handed]);

    // The collection the Draft is in, not the one the page opens on.
    expect(await screen.findByRole("heading", { name: "Drafts" })).toBeTruthy();
    expect(currentCollection()).toBe("Drafts");
    // And that Draft is the pane's subject, not the first Draft in the list.
    const pane = await screen.findByRole("region", { name: "Draft detail" });
    expect(
      (within(pane).getByRole("textbox", { name: `Name for ${handed.name}` }) as HTMLInputElement)
        .value,
    ).toBe(handed.name);
    expect(within(draftList()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("spends the handoff, so the next visit to Library opens on Snapshots", async () => {
    handOffDraft(DRAFT.id);

    const first = renderLibrary([DRAFT]);
    expect(await screen.findByRole("heading", { name: "Drafts" })).toBeTruthy();
    // Leaving Library unmounts the page; coming back is a fresh arrival, and an
    // intent that was not spent would put the user in Drafts every time.
    first.ui.unmount();

    renderLibrary([DRAFT]);
    expect(await screen.findByRole("heading", { name: "Snapshots" })).toBeTruthy();
    expect(currentCollection()).toBe("Snapshots");
  });
});
