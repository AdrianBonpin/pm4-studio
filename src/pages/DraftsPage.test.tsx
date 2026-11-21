// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { DraftsPage } from "./DraftsPage";
import { fakeBackend, renderUi } from "../test/dom";
import type { Draft, DraftsView } from "../lib/drafts";
import type { LibraryProblem } from "../lib/library";

/**
 * Gate 2 of 8: deleting a Draft.
 *
 * A Snapshot can be read off its Tag again; a Draft was authored and never lived
 * on a Tag, so nothing can regenerate it. Draft delete is therefore the one
 * removal in the app with no way back, and it asks first: the row's trash control
 * opens a confirmation naming the Draft, and the removal happens from that
 * confirmation's button, not from the trash control.
 *
 * The three tests below are the pair the defect section asks for, plus the
 * narrowness the ticket adds. Dismissing must remove nothing (which fails if the
 * removal is wired straight to the trash control); confirming must remove that
 * Draft and no other; and the Draft that was dismissed must still be there
 * afterwards. Eight gates is D5's number, and it is true only because this one
 * exists — ticket 01 proved the seven that already had a confirmation and could
 * not prove a gate that was not there (see the correction note in D5).
 *
 * The store is reached through `invoke`, like every other persisted call, so the
 * fake backend stands at that boundary and the real hook runs unmodified.
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

function view(drafts: Draft[], problem: LibraryProblem | null = null): DraftsView {
  return { drafts, problem };
}

/** Every Draft on screen, by name, in the order the list renders them. */
function listedNames(): string[] {
  return screen
    .queryAllByRole("button", { name: /^Rename / })
    .map((control) => control.getAttribute("aria-label") ?? "")
    .map((label) => label.replace(/^Rename /, ""));
}

describe("deleting a Draft", () => {
  it("asks before it removes anything, and keeping the Draft removes nothing", async () => {
    const backend = fakeBackend({
      drafts_load: () => view([DRAFT, OTHER]),
      draft_delete: () => view([OTHER]),
    });

    const { user } = renderUi(<DraftsPage connected={false} />);

    await user.click(await screen.findByRole("button", { name: `Delete ${DRAFT.name}` }));

    // The confirmation is on screen, and it names the Draft it is about to
    // remove. While it is open the row's own title is replaced by it, so the
    // name has nowhere else to come from.
    const prompt = screen.getByText(/Delete\s+permanently\?/);
    expect(prompt.textContent).toContain(DRAFT.name);
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    // The control that destroys the Draft reads as destructive, as every other
    // irreversible action in the app does.
    expect(confirm.className).toContain("border-err");

    await user.click(screen.getByRole("button", { name: "Keep" }));

    // Dismissed: the store was never asked to remove anything, and both Drafts
    // are still listed exactly as they were.
    expect(backend.callsTo("draft_delete")).toHaveLength(0);
    expect(listedNames()).toEqual([DRAFT.name, OTHER.name]);
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
  });

  it("removes that Draft through the store when the confirmation is confirmed", async () => {
    const backend = fakeBackend({
      drafts_load: () => view([DRAFT, OTHER]),
      draft_delete: () => view([OTHER]),
    });

    const { user } = renderUi(<DraftsPage connected={false} />);

    await user.click(await screen.findByRole("button", { name: `Delete ${DRAFT.name}` }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(backend.callsTo("draft_delete")).toHaveLength(1);
    });
    // That Draft, and no other.
    expect(backend.callsTo("draft_delete")[0]?.args).toEqual({ id: DRAFT.id });
  });

  it("leaves every other Draft in place when one is confirmed away", async () => {
    const backend = fakeBackend({
      drafts_load: () => view([DRAFT, OTHER, THIRD]),
      draft_delete: () => view([DRAFT, THIRD]),
    });

    const { user } = renderUi(<DraftsPage connected={false} />);

    await user.click(await screen.findByRole("button", { name: `Delete ${OTHER.name}` }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(listedNames()).toEqual([DRAFT.name, THIRD.name]);
    });
    // One removal was asked for, and it named the row whose control was used.
    expect(backend.callsTo("draft_delete").map((call) => call.args)).toEqual([{ id: OTHER.id }]);
  });
});
