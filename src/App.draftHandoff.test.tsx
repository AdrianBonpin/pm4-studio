// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { DraftsProvider } from "./components/DraftsProvider";
import { fakeBackend, renderUi, type CommandAnswer } from "./test/dom";
import { libraryView } from "./test/libraryState";
import { NTAG_CAPTURE, NTAG_UID, recordsRead } from "./test/hfState";
import { toastStore } from "./lib/toastStore";
import type { Draft, DraftsView } from "./lib/drafts";
import type { DeviceInfo } from "./types";

/**
 * Ticket 16, end to end: a reading becomes a Draft and the user lands in it.
 *
 * The action is on 13.56 MHz and the Collection switch is in Library, so the two
 * halves are joined by the shell — the Draft is created by the page, handed to
 * the shell, and the shell changes destination. This file is the proof that the
 * join exists: press the action on one destination and the other one is on
 * screen, in the Drafts collection, with the new Draft open in the pane beside
 * the list.
 *
 * The app is mounted as `main.tsx` mounts it, inside the provider that owns the
 * Drafts queue, because that is where the queue lives in the shipped app.
 */

const READER: DeviceInfo = {
  vid: 0x1d6b,
  pid: 0x0242,
  product: "NFC-PM4",
  manufacturer: "PM4",
  serial: "0123456789",
};

function view(drafts: Draft[]): DraftsView {
  return { drafts, problem: null, migrationWarning: null };
}

/** A Drafts store behind the IPC boundary, and the same store the test inspects. */
function draftsStore(): { answers: Record<string, CommandAnswer>; stored: Draft[] } {
  const stored: Draft[] = [];
  let next = 0;
  return {
    stored,
    answers: {
      drafts_load: () => view(stored),
      draft_create: (args) => {
        next += 1;
        stored.push({
          id: `draft-${next}`,
          name: String(args.name ?? ""),
          updatedAt: String(args.updatedAt ?? ""),
          records: [],
        });
        return view(stored);
      },
      draft_save: (args) => {
        const saved = structuredClone(args.draft as Draft);
        const at = stored.findIndex((held) => held.id === saved.id);
        if (at >= 0) stored[at] = saved;
        return view(stored);
      },
    },
  };
}

afterEach(() => {
  toastStore.clear();
});

describe("from the 13.56 MHz readout to the Draft it becomes", () => {
  it("lands in Library, in the Drafts collection, on the Draft it just created", async () => {
    const store = draftsStore();
    fakeBackend({
      library_load: () => libraryView([]),
      beep: () => null,
      // The Reader is attached: a read needs one, and nothing about making a
      // Draft from its message does.
      connect: () => READER,
      firmware_version: () => "H00S07",
      hf_poll: () => NTAG_CAPTURE,
      ntag_records_read: () => recordsRead(),
      ...store.answers,
    });

    const { user } = renderUi(
      <DraftsProvider>
        <App />
      </DraftsProvider>,
    );

    // To 13.56 MHz, and read the Tag the capture describes.
    await user.click(
      within(screen.getByRole("navigation", { name: "Destinations" })).getByRole("button", {
        name: "13.56 MHz",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Read tag" }));
    await screen.findByText("hello");

    // The one action, on the readout that holds the Records.
    await user.click(screen.getByRole("button", { name: "Edit as Draft" }));

    // Library, showing the Drafts collection rather than its opening Snapshots.
    const switchGroup = await screen.findByRole("group", { name: "Collection" });
    await waitFor(() => {
      const pressed = within(switchGroup)
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-pressed") === "true");
      expect(pressed.map((button) => button.textContent)).toEqual(["Drafts"]);
    });

    // And the Draft it made is the open one, named after the Tag it was read
    // from, holding the message's Records in the Tag's order.
    const pane = await screen.findByRole("region", { name: "Draft detail" });
    expect(
      (within(pane).getByRole("textbox", { name: `Name for ${NTAG_UID}` }) as HTMLInputElement)
        .value,
    ).toBe(NTAG_UID);
    expect(
      (within(pane).getByRole("textbox", { name: "Text" }) as HTMLInputElement).value,
    ).toBe("hello");
    expect((within(pane).getByRole("textbox", { name: "URL" }) as HTMLInputElement).value).toBe(
      "https://devgo.studio",
    );

    // It is one Draft, and the message was reported as it was made.
    expect(store.stored).toHaveLength(1);
    expect(toastStore.getState().toasts[0]?.message).toBe(
      `Draft created from ${NTAG_UID} — 2 Records.`,
    );
  });
});
