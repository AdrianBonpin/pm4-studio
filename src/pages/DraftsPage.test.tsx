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
 * **This gate has no confirmation.** The list row's trash control calls the
 * store's `draft_delete` directly — there is no second, deliberate click and no
 * confirmation naming the Draft. The other seven gates have one; this one does
 * not, which is recorded in the ticket rather than fixed here, because adding a
 * confirmation would change shipped behaviour and this ticket adds proof.
 *
 * So only the confirming half of the pair can be proven: the control removes the
 * Draft it is on, through the store call, and not another one. The dismissing
 * half has nothing to dismiss, and inventing it would mean writing a test for a
 * control the app does not have.
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

function view(drafts: Draft[], problem: LibraryProblem | null = null): DraftsView {
  return { drafts, problem };
}

describe("deleting a Draft", () => {
  it("removes that Draft through the store when the control is used", async () => {
    const backend = fakeBackend({
      drafts_load: () => view([DRAFT, { ...DRAFT, id: "draft-2", name: "Canteen sign" }]),
      draft_delete: () => view([{ ...DRAFT, id: "draft-2", name: "Canteen sign" }]),
    });

    const { user } = renderUi(<DraftsPage connected={false} />);

    // The list arrives from the store, so nothing is shown until it answers.
    const remove = await screen.findByRole("button", { name: "Delete Loading bay sign" });
    await user.click(remove);

    await waitFor(() => {
      expect(backend.callsTo("draft_delete")).toHaveLength(1);
    });
    // That Draft, and no other.
    expect(backend.callsTo("draft_delete")[0]?.args).toEqual({ id: DRAFT.id });
  });
});
