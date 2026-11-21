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

function view(
  drafts: Draft[],
  problem: LibraryProblem | null = null,
  migrationWarning: string | null = null,
): DraftsView {
  return { drafts, problem, migrationWarning };
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

/**
 * Ticket 04 / ADR 0005: a version 1 library is lifted on open, and a lift that
 * cannot be written is reported. The Drafts are the reason the version exists —
 * they are the collection an older build would have dropped — so the page says
 * when the file still carries the older claim, and stays usable.
 */
describe("a library lifted from an older schema", () => {
  const WARNING =
    "This library was written for schema 1 and has been read as schema 2. It could not be rewritten: permission denied. Everything in it is open and usable, and saving will correct the file.";

  it("shows every Draft and reports the lift that could not be written", async () => {
    fakeBackend({ drafts_load: () => view([DRAFT], null, WARNING) });

    renderUi(<DraftsPage connected={false} />);

    expect(await screen.findByText(DRAFT.name)).toBeTruthy();
    expect(screen.getByText(/could not be rewritten/)).toBeTruthy();
    // A warning, not a lock: the file was read whole, so saving stays on.
    const create = screen.getByRole("button", { name: "New Draft" });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });

  it("says nothing when the lift was written", async () => {
    fakeBackend({ drafts_load: () => view([DRAFT]) });

    renderUi(<DraftsPage connected={false} />);

    expect(await screen.findByText(DRAFT.name)).toBeTruthy();
    expect(screen.queryByText(/could not be rewritten/)).toBeNull();
  });
});
