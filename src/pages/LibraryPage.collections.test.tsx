// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { LibraryPage } from "./LibraryPage";
import { DraftsProvider } from "../components/DraftsProvider";
import { fakeBackend, renderUi } from "../test/dom";
import { libraryState } from "../test/libraryState";
import type { Draft, DraftsView } from "../lib/drafts";

/**
 * Drafts is reachable inside Library as its second Collection.
 *
 * Drafts stops being a destination in this slice — the sidebar is five
 * destinations and Drafts is not one of them — but the Drafts that already exist
 * must not become unreachable, and neither must the editor that makes them. So
 * Library carries a Collection switch, and this file is the proof that flipping it
 * lands on the Drafts page the app already had, unmodified, and that flipping it
 * back returns to the Snapshots.
 *
 * Ticket 10 gives the collection the two-pane shape the spec asks for. This slice
 * deliberately does not: it makes Drafts reachable and changes nothing about how
 * a Draft is edited.
 */

const DRAFT: Draft = {
  id: "draft-1",
  name: "Loading bay sign",
  updatedAt: new Date().toISOString(),
  records: [],
};

function draftsView(drafts: Draft[]): DraftsView {
  return { drafts, problem: null, migrationWarning: null };
}

/** The page as the app mounts it: Library, inside the provider Drafts needs. */
function renderLibrary() {
  const backend = fakeBackend({
    // Drafts are read through the same library file, on their own command.
    drafts_load: () => draftsView([DRAFT]),
  });
  const ui = renderUi(
    <DraftsProvider>
      <LibraryPage connected={false} library={libraryState()} onChirp={() => {}} />
    </DraftsProvider>,
  );
  return { backend, ui };
}

/** The Collection switch, which is how a user moves between the two. */
function collectionSwitch() {
  return screen.getByRole("group", { name: "Collection" });
}

describe("Library's two collections", () => {
  it("opens on Snapshots, and says which collection is current", () => {
    renderLibrary();

    expect(
      within(collectionSwitch()).getByRole("button", { name: "Snapshots" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(collectionSwitch()).getByRole("button", { name: "Drafts" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("reaches the Drafts page, unchanged, in one click", async () => {
    const { ui } = renderLibrary();

    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Drafts" }));

    // The same Drafts editor as before, with the Draft that is on disk: the
    // Collection switch re-homes the page rather than rewriting it.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Rename Loading bay sign/ })).toBeTruthy();
    });
    expect(
      within(collectionSwitch()).getByRole("button", { name: "Drafts" }).getAttribute("aria-pressed"),
    ).toBe("true");
    // The Snapshots list is not underneath it: one collection at a time.
    expect(screen.queryByRole("button", { name: "Export library…" })).toBeNull();
  });

  it("comes back to Snapshots without losing the collection switch", async () => {
    const { ui } = renderLibrary();

    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Drafts" }));
    await ui.user.click(within(collectionSwitch()).getByRole("button", { name: "Snapshots" }));

    // The Snapshots content is back, and the switch still names both collections.
    expect(screen.getByRole("button", { name: "Export library…" })).toBeTruthy();
    expect(within(collectionSwitch()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Snapshots",
      "Drafts",
    ]);
  });
});
