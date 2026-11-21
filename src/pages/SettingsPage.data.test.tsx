// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import { fakeBackend, renderUi, type CommandAnswer } from "../test/dom";
import { libraryState } from "../test/libraryState";
import { BEEP_KEY } from "../lib/preferences";
import { LEGACY_STORE_KEY } from "../lib/storage";
import { TOAST_CORNER_KEY } from "../lib/toastCorner";
import { toastStore } from "../lib/toastStore";
import type { LibraryState } from "../hooks/useLibrary";

/**
 * Settings → Data: the library's file, export and import, and the one action that
 * clears everything this app saved.
 *
 * What these tests hold:
 *   - the file's location is shown, and can be revealed in the file manager;
 *   - export and import work here exactly as they did on the Library page,
 *     because they were moved rather than reinvented;
 *   - clearing is gated by typing the word, reports exactly what it removed, and
 *     names the part that stopped it when it refuses;
 *   - a clear reloads the library, so the app is in its first-run state without a
 *     restart.
 */

const LIBRARY_PATH = "/Users/someone/Library/Application Support/pm4-studio/library.json";

interface MountOptions {
  readonly library?: LibraryState;
  readonly answers?: Record<string, CommandAnswer>;
}

function mount(options: MountOptions = {}) {
  const library = options.library ?? libraryState();
  const backend = fakeBackend({ beep: () => null, ...options.answers });
  const ui = renderUi(
    <SettingsPage
      reader={{ connected: true, info: null, firmware: null }}
      beepOn
      onBeepOnChange={() => {}}
      library={library}
    />,
  );
  return { backend, ui, library };
}

function groupSwitch() {
  return screen.getByRole("group", { name: "Settings group" });
}

async function openData(user: ReturnType<typeof renderUi>["user"]) {
  await user.click(within(groupSwitch()).getByRole("button", { name: "Data" }));
}

function clearedFiles(
  removed: { target: "libraryFile" | "staleTemp"; path: string; bytes: number }[] = [],
  blocked: { target: "libraryFile" | "staleTemp"; path: string; reason: string } | null = null,
) {
  return { cleared: blocked === null, removed, blocked };
}

beforeEach(() => {
  localStorage.clear();
  toastStore.clear();
});

describe("the library file", () => {
  it("shows where the whole library is kept", async () => {
    const { ui } = mount();
    await openData(ui.user);

    // The path is machine data, shown in full: "somewhere I cannot find" was the
    // problem this group exists to fix.
    expect(screen.getByText(LIBRARY_PATH)).toBeTruthy();
  });

  it("reveals the file in the system file manager, without being told a path", async () => {
    const { backend, ui } = mount({ answers: { library_reveal: () => LIBRARY_PATH } });
    await openData(ui.user);

    await ui.user.click(screen.getByRole("button", { name: "Reveal in file manager" }));

    await waitFor(() => {
      expect(backend.callsTo("library_reveal")).toHaveLength(1);
    });
    // No argument: the app reveals the file it resolved, not a path typed in.
    expect(backend.callsTo("library_reveal")[0]?.args).toEqual({});
    expect(screen.getByText(LIBRARY_PATH)).toBeTruthy();
  });
});

describe("export and import", () => {
  it("exports the whole library to the file the user chose", async () => {
    const pickPath = vi.fn(async () => "/tmp/pm4-library-2026-11-22.json");
    const exportTo = vi.fn(async () => ({
      path: "/tmp/pm4-library-2026-11-22.json",
      snapshots: 2,
      drafts: 1,
    }));
    const { ui } = mount({ library: libraryState({ pickPath, exportTo }) });
    await openData(ui.user);

    await ui.user.click(screen.getByRole("button", { name: "Export library…" }));

    await waitFor(() => {
      expect(exportTo).toHaveBeenCalledWith("/tmp/pm4-library-2026-11-22.json");
    });
    // The dialog is offered an export name, as it always was.
    expect(pickPath).toHaveBeenCalledWith("save", expect.stringMatching(/^pm4-library-\d{4}-\d{2}-\d{2}\.json$/));
    expect(await screen.findByText("Exported 2 Snapshots and 1 Draft.")).toBeTruthy();
  });

  it("asks what an import would add before writing anything", async () => {
    const pickPath = vi.fn(async () => "/tmp/backup.json");
    const previewImport = vi.fn(async () => ({
      snapshotsAdded: 2,
      snapshotsConflicting: 1,
      draftsAdded: 0,
      draftsConflicting: 0,
    }));
    const applyImport = vi.fn(async () => ({
      preview: { snapshotsAdded: 2, snapshotsConflicting: 1, draftsAdded: 0, draftsConflicting: 0 },
      library: libraryState().view!,
    }));
    const { ui } = mount({ library: libraryState({ pickPath, previewImport, applyImport }) });
    await openData(ui.user);

    await ui.user.click(screen.getByRole("button", { name: "Import library…" }));

    // The preview says what would be added and what would be left alone; no
    // write has happened until "Add to library".
    expect(
      await screen.findByText(
        "2 Snapshots will be added. 1 Snapshot is already in the library and will be left alone.",
      ),
    ).toBeTruthy();
    expect(applyImport).not.toHaveBeenCalled();

    await ui.user.click(screen.getByRole("button", { name: "Add to library" }));

    await waitFor(() => {
      expect(applyImport).toHaveBeenCalledWith("/tmp/backup.json");
    });
    expect(await screen.findByText("Added 2 Snapshots. 1 Snapshot was already in the library and left alone.")).toBeTruthy();
  });
});

describe("clearing every saved thing", () => {
  it("cannot be started by a click: the word has to be typed", async () => {
    const { backend, ui } = mount();
    await openData(ui.user);

    const clearButton = screen.getByRole("button", { name: "Clear all saved data" });
    expect((clearButton as HTMLButtonElement).disabled).toBe(true);

    const gate = screen.getByLabelText("Type clear to confirm");
    for (const nearly of ["Clea", "CLEAR", "clear-ish", "yes"]) {
      await ui.user.clear(gate);
      await ui.user.type(gate, nearly);
      expect(
        (screen.getByRole("button", { name: "Clear all saved data" }) as HTMLButtonElement).disabled,
        nearly,
      ).toBe(true);
    }
    expect(backend.callsTo("clear_all_saved_data")).toHaveLength(0);

    await ui.user.clear(gate);
    await ui.user.type(gate, "clear");
    const armed = screen.getByRole("button", { name: "Clear all saved data" });
    expect((armed as HTMLButtonElement).disabled).toBe(false);

    // Typing it is not doing it: the button is still a second, deliberate act.
    expect(backend.callsTo("clear_all_saved_data")).toHaveLength(0);
  });

  it("removes, reports exactly what went, and shows the first-run library without a restart", async () => {
    localStorage.setItem(LEGACY_STORE_KEY, "[]");
    localStorage.setItem(BEEP_KEY, "0");
    const reload = vi.fn(async () => {});
    const { backend, ui, library } = mount({
      library: libraryState({ reload }),
      answers: {
        clear_all_saved_data: () =>
          clearedFiles([
            { target: "libraryFile", path: LIBRARY_PATH, bytes: 2048 },
            { target: "staleTemp", path: `${LIBRARY_PATH}.tmp`, bytes: 12 },
          ]),
      },
    });
    await openData(ui.user);

    await ui.user.type(screen.getByLabelText("Type clear to confirm"), "clear");
    await ui.user.click(screen.getByRole("button", { name: "Clear all saved data" }));

    await waitFor(() => {
      expect(backend.callsTo("clear_all_saved_data")).toHaveLength(1);
    });
    // No path argument: the file targets are resolved in Rust.
    expect(backend.callsTo("clear_all_saved_data")[0]?.args).toEqual({});

    expect(await screen.findByText("Cleared all saved data.")).toBeTruthy();
    // Exactly what was removed, and nothing that was not there. The path is on
    // the page twice: once as where the library lives, once as what went.
    expect(screen.getByText("the library file (2,048 bytes):")).toBeTruthy();
    expect(screen.getAllByText(LIBRARY_PATH)).toHaveLength(2);
    expect(screen.getByText("the temporary file a save may have left beside it (12 bytes):")).toBeTruthy();
    expect(screen.getByText(`${LIBRARY_PATH}.tmp`)).toBeTruthy();
    // The stored preferences went with it, and are reported by key.
    expect(screen.getByText("the legacy saved-reads store:")).toBeTruthy();
    expect(screen.getByText(LEGACY_STORE_KEY)).toBeTruthy();
    expect(screen.getByText("the beep preference:")).toBeTruthy();
    expect(screen.getByText(BEEP_KEY)).toBeTruthy();
    // The reported keys really are gone from this window.
    expect(localStorage.getItem(LEGACY_STORE_KEY)).toBeNull();
    expect(localStorage.getItem(BEEP_KEY)).toBeNull();

    // The shell is asked to re-read the library, so the page is not showing a
    // file that no longer exists.
    expect(reload).toHaveBeenCalled();
    expect(library).toBeTruthy();
  });

  it("says it refused and names the part, and does not claim a partial clear", async () => {
    const reload = vi.fn(async () => {});
    const { ui } = mount({
      library: libraryState({ reload }),
      answers: {
        clear_all_saved_data: () =>
          clearedFiles([], {
            target: "staleTemp",
            path: `${LIBRARY_PATH}.tmp`,
            reason: "it is a symbolic link, and this action never follows one",
          }),
      },
    });
    await openData(ui.user);

    await ui.user.type(screen.getByLabelText("Type clear to confirm"), "clear");
    await ui.user.click(screen.getByRole("button", { name: "Clear all saved data" }));

    expect(
      await screen.findByText(
        "Nothing was cleared: the temporary file a save may have left beside it could not be removed.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/it is a symbolic link, and this action never follows one/)).toBeTruthy();
    // Nothing went, so there is nothing to list and nothing to reload.
    expect(screen.queryByText("This is exactly what was removed:")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("says the same thing in the message as it does on the page", async () => {
    const { ui } = mount({
      answers: { clear_all_saved_data: () => clearedFiles() },
    });
    await openData(ui.user);

    await ui.user.type(screen.getByLabelText("Type clear to confirm"), "clear");
    await ui.user.click(screen.getByRole("button", { name: "Clear all saved data" }));

    await waitFor(() => {
      expect(toastStore.getState().toasts).toHaveLength(1);
    });
    // One report, two channels: the words cannot drift apart.
    expect(toastStore.getState().toasts[0]?.message).toBe("There was nothing saved to clear.");
    expect(screen.getByText("There was nothing saved to clear.")).toBeTruthy();
  });

  it("clears the preference keys this window owns, and falls back to the defaults", async () => {
    localStorage.setItem(TOAST_CORNER_KEY, "top-left");
    const { ui } = mount({
      answers: { clear_all_saved_data: () => clearedFiles() },
    });
    await openData(ui.user);

    await ui.user.type(screen.getByLabelText("Type clear to confirm"), "clear");
    await ui.user.click(screen.getByRole("button", { name: "Clear all saved data" }));

    await waitFor(() => {
      expect(localStorage.getItem(TOAST_CORNER_KEY)).toBeNull();
    });
    expect(screen.getByText("the message-corner preference:")).toBeTruthy();

    // The cleared preference falls back to its documented default in the window
    // that is already open, rather than at the next launch.
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "Feedback" }));
    const corners = screen.getByRole("group", { name: "Messages appear in" });
    expect(
      within(corners).getByRole("button", { name: "Bottom right" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
