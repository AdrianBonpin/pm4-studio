// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { fakeBackend, renderUi } from "./test/dom";
import { libraryView } from "./test/libraryState";
import { toastStore } from "./lib/toastStore";
import type { DeviceInfo } from "./types";

/**
 * The shell: five destinations, and the sidebar reduced to navigation and
 * connection.
 *
 * What this file holds, and why each one is a test rather than a review note:
 *
 *   - **Five destinations, and the one you are on is marked.** The set is the
 *     ticket, and `aria-current` is how a screen reader is told which of five
 *     the user is looking at.
 *   - **The destination survives a detour.** Looking at the Tools page and coming
 *     back must not silently put the user on 125 kHz.
 *   - **The sidebar carries no preference.** The beep used to sit in the footer,
 *     disabled whenever the Reader was unplugged, for a value that is stored in
 *     this machine's own storage. It is in Settings now.
 *   - **No page repeats the credits.** They were a footer on every page; they are
 *     a fact in Settings → About.
 *   - **Every destination renders with no Reader attached.** The library, the
 *     settings and the console do not need hardware, and a page that only renders
 *     when a device is present is a page that fails the moment the cable is loose.
 *
 * No Reader is attached in this file at all: `connect` rejects, which is the
 * state a machine with no hardware is in.
 */

const READER: DeviceInfo = {
  vid: 0x1d6b,
  pid: 0x0242,
  product: "NFC-PM4",
  manufacturer: "PM4",
  serial: "0123456789",
};

const DESTINATIONS = ["125 kHz", "13.56 MHz", "Library", "Tools", "Settings"];

/** Everything the shell asks for at launch, in the no-Reader state. */
function noReader() {
  return {
    library_load: () => libraryView([]),
    beep: () => null,
    connect: () => {
      throw "no such device: failed to open the reader";
    },
  };
}

/** The sidebar column: navigation above, connection below, and nothing else. */
function sidebar(): HTMLElement {
  const element = document.querySelector("aside");
  if (!element) throw new Error("the shell has no sidebar");
  return element;
}

/** The five destinations, as the sidebar renders them. */
function destinations(): HTMLElement[] {
  return within(screen.getByRole("navigation", { name: "Destinations" })).getAllByRole("button");
}

/** The destination marked as the current one, by its accessible name. */
function current(): string | null {
  const marked = destinations().filter((button) => button.getAttribute("aria-current") === "page");
  expect(marked).toHaveLength(1);
  return marked[0]?.textContent ?? null;
}

afterEach(() => {
  toastStore.clear();
});

describe("the sidebar's five destinations", () => {
  it("offers exactly the five, in the order the work happens", () => {
    fakeBackend(noReader());
    renderUi(<App />);

    expect(destinations().map((button) => button.textContent)).toEqual(DESTINATIONS);
    // Drafts is not one of them: it is a Collection inside Library (see
    // `pages/LibraryPage.collections.test.tsx`).
    expect(screen.queryByRole("button", { name: "Drafts" })).toBeNull();
  });

  it("marks the destination you are on for assistive technology", async () => {
    fakeBackend(noReader());
    const { user } = renderUi(<App />);

    expect(current()).toBe("125 kHz");

    await user.click(within(sidebar()).getByRole("button", { name: "Library" }));
    expect(current()).toBe("Library");

    await user.click(within(sidebar()).getByRole("button", { name: "Settings" }));
    expect(current()).toBe("Settings");
  });

  it("keeps your place when you look somewhere else and come back", async () => {
    fakeBackend(noReader());
    const { user } = renderUi(<App />);

    await user.click(within(sidebar()).getByRole("button", { name: "Library" }));
    await user.click(within(sidebar()).getByRole("button", { name: "Tools" }));
    await user.click(within(sidebar()).getByRole("button", { name: "Library" }));

    // Back where the user left off, not reset to the first destination.
    expect(current()).toBe("Library");
    expect(screen.getByRole("heading", { level: 1, name: "Library" })).toBeTruthy();
  });

  it("renders every destination with no Reader attached", async () => {
    fakeBackend(noReader());
    const { user } = renderUi(<App />);

    for (const destination of DESTINATIONS) {
      await user.click(within(sidebar()).getByRole("button", { name: destination }));
      const main = document.querySelector("main");
      expect(main?.textContent ?? "", destination).not.toBe("");
      expect(
        screen.getByRole("heading", { level: 1, name: destination }),
        destination,
      ).toBeTruthy();
    }
    // And the shell still says why there is no hardware, rather than looking broken.
    expect(await screen.findByText("No Reader attached")).toBeTruthy();
  });
});

describe("the sidebar is navigation and connection, not preferences", () => {
  it("carries no beep control", () => {
    fakeBackend(noReader());
    renderUi(<App />);

    // The preference lives in Settings → Feedback, where it does not care
    // whether the Reader is plugged in.
    expect(within(sidebar()).queryByRole("switch")).toBeNull();
    expect(within(sidebar()).queryByText("Beep")).toBeNull();
  });

  it("keeps the Reader, its status, its firmware and Connect available from anywhere", async () => {
    fakeBackend({ ...noReader(), connect: () => READER, firmware_version: () => "H00S07" });
    const { user } = renderUi(<App />);

    await waitFor(() => {
      expect(within(sidebar()).getByText("NFC-PM4")).toBeTruthy();
    });
    // Still there after navigating away: the connection is not a page.
    await user.click(within(sidebar()).getByRole("button", { name: "Tools" }));
    expect(within(sidebar()).getByText("H00S07")).toBeTruthy();
    expect(within(sidebar()).getByRole("button", { name: "Reconnect" })).toBeTruthy();
  });
});

describe("the credits that used to repeat on every page", () => {
  it("are gone from the page flow, and live in Settings → About instead", async () => {
    fakeBackend(noReader());
    const { user } = renderUi(<App />);

    for (const destination of DESTINATIONS) {
      await user.click(within(sidebar()).getByRole("button", { name: destination }));
      const main = document.querySelector("main")?.textContent ?? "";
      expect(main, destination).not.toContain("Protocol reverse-engineered");
      expect(main, destination).not.toContain("vicrodh/cyb-nfc");
    }

    await user.click(within(sidebar()).getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "About" }));

    expect(screen.getByRole("link", { name: "vicrodh/cyb-nfc" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "journeyman846/nfcx-tool" })).toBeTruthy();
  });
});

describe("the beeper test in Settings", () => {
  it("sounds through the outcome seam, and says so on screen", async () => {
    const backend = fakeBackend({ ...noReader(), connect: () => READER, firmware_version: () => "H00S07" });
    const { user } = renderUi(<App />);

    await user.click(within(sidebar()).getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Beep test" }));

    // The audible half is the shell's subscriber, installed once by `useBeep`;
    // this proves the control reaches the beeper through the seam rather than
    // around it.
    await waitFor(() => {
      expect(backend.callsTo("beep")).toHaveLength(1);
    });
    // And the visible half, because a signal is never the only channel.
    expect(await screen.findByText("Signal sent.")).toBeTruthy();
  });
});
