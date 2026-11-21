// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { LibraryPage } from "./LibraryPage";
import { fakeBackend, renderUi } from "../test/dom";
import { SNAPSHOT, libraryState, libraryView } from "../test/libraryState";

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

/**
 * Ticket 04 / ADR 0005: a library file written by an older schema is lifted on
 * open. When the lift cannot be written, the app keeps working with the lifted
 * library in memory and says so — the file on disk still claims the older
 * version until the next save, which is a warning, not a lock. Every control
 * that writes stays usable, because a save is what corrects the file.
 */
describe("a lift that could not be written", () => {
  const WARNING =
    "This library was written for schema 1 and has been read as schema 2. It could not be rewritten: permission denied. Everything in it is open and usable, and saving will correct the file.";

  it("reports the warning without turning off saving", () => {
    fakeBackend();
    renderUi(
      <LibraryPage
        connected={false}
        library={libraryState({
          view: { ...libraryView(), migrationWarning: WARNING },
        })}
        onChirp={() => {}}
      />,
    );

    expect(screen.getByText(/could not be rewritten/)).toBeTruthy();

    // The file must not be written to only when it cannot be read. This one was
    // read whole, so the Snapshot controls are live.
    const trash = screen.getByRole("button", { name: `Delete ${SNAPSHOT.name}` });
    expect((trash as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Saving is turned off/)).toBeNull();
  });

  it("says nothing when the file was lifted and written", () => {
    fakeBackend();
    renderUi(
      <LibraryPage connected={false} library={libraryState()} onChirp={() => {}} />,
    );

    expect(screen.queryByText(/could not be rewritten/)).toBeNull();
  });
});
