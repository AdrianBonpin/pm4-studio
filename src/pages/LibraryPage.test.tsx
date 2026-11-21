// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { LibraryPage } from "./LibraryPage";
import { fakeBackend, renderUi } from "../test/dom";
import { SNAPSHOT, libraryState } from "../test/libraryState";

/**
 * Gate 1 of 8: deleting a Snapshot from the library.
 *
 * Deleting is permanent — the Snapshot is removed from the library file and no
 * copy is kept — so the row's trash control opens a confirmation and the removal
 * happens from that confirmation's button, not from the trash control. The two
 * tests below are the pair the defect section asks for: one clicks the
 * destructive control and dismisses, one confirms. Between them they fail if the
 * removal is wired straight to the trash control (the dismiss test's assertion
 * that nothing was removed would break) and if the confirmation's button removes
 * the wrong Snapshot (the confirm test names the id).
 *
 * The library arrives as a prop, with every call spied: the component is driven
 * through its own interface, and the store behind it never runs.
 */
describe("deleting a Snapshot", () => {
  it("asks before it removes anything, and keeping the Snapshot removes nothing", async () => {
    fakeBackend();
    const remove = vi.fn(async (_id: string) => {});
    const { user } = renderUi(
      <LibraryPage connected={false} library={libraryState({ remove })} onChirp={() => {}} />,
    );

    await user.click(screen.getByRole("button", { name: `Delete ${SNAPSHOT.name}` }));

    // The confirmation is on screen: the row's trash control is one click, the
    // removal is a second, deliberate one.
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Keep" }));

    // Dismissed: nothing was removed, and the Snapshot is still listed.
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(SNAPSHOT.name)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
  });

  it("removes that Snapshot when the confirmation is confirmed", async () => {
    fakeBackend();
    const remove = vi.fn(async (_id: string) => {});
    const { user } = renderUi(
      <LibraryPage connected={false} library={libraryState({ remove })} onChirp={() => {}} />,
    );

    await user.click(screen.getByRole("button", { name: `Delete ${SNAPSHOT.name}` }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(remove).toHaveBeenCalledTimes(1);
    });
    // That Snapshot, and no other: a confirmation wired to the wrong row would
    // remove a different one and still satisfy a bare "was called".
    expect(remove.mock.calls).toEqual([[SNAPSHOT.id]]);
  });
});
