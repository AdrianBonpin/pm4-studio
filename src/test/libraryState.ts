/**
 * The library as a prop, for the components that take one.
 *
 * `LibraryPage` and `AuthorIdentity` both receive their store as a prop rather
 * than reaching for it, so a test hands them a state written down here. The
 * calls are spies: this is the component's own interface, not an internal
 * collaborator, and the assertions are about what the interface did.
 */

import { vi } from "vitest";
import type { LibraryState } from "../hooks/useLibrary";
import type { LibraryView, Snapshot } from "../lib/library";

/** One Snapshot in the library, carrying an Identity. */
export const SNAPSHOT: Snapshot = {
  id: "55 00 84 82 12",
  name: "Front door",
  note: "",
  kind: "LF",
  capturedAt: new Date().toISOString(),
  writeCount: 0,
  identity: {
    customer: 0x55,
    data32: 0x0084_8212,
    facility: 0x84,
    card: 0x8212,
    raw: "55 00 84 82 12",
  },
};

/** The library file the app would have read at launch. */
export function libraryView(snapshots: Snapshot[] = [SNAPSHOT]): LibraryView {
  return {
    path: "/Users/someone/Library/Application Support/pm4-studio/library.json",
    version: 2,
    snapshots,
    problem: null,
  };
}

/** A library state with every call spied, and no file behind it. */
export function libraryState(overrides: Partial<LibraryState> = {}): LibraryState {
  return {
    view: libraryView(),
    error: null,
    loading: false,
    saveLf: vi.fn(async () => null),
    rename: vi.fn(async (_id: string, _name: string) => {}),
    edit: vi.fn(async (_id: string, _draft: { name: string; note: string }) => {}),
    remove: vi.fn(async (_id: string) => {}),
    reload: vi.fn(async () => {}),
    pickPath: vi.fn(async () => null),
    exportTo: vi.fn(async () => null),
    previewImport: vi.fn(async () => null),
    applyImport: vi.fn(async () => null),
    ...overrides,
  };
}
