// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { fakeBackend, renderUi } from "./test/dom";
import { libraryView } from "./test/libraryState";
import { toastStore } from "./lib/toastStore";
import type { DeviceInfo } from "./types";

/**
 * The shell's device failure, as a message rather than a strip.
 *
 * The strip used to sit at the top of the content column, so a loose cable pushed
 * the page down under it. It is gone; the same news now arrives as a message in
 * the corner the user chose, with the same two controls it carried — a
 * reconnect, and a dismiss.
 *
 * The message must not be part of the page flow: `main` is asserted to know
 * nothing about it.
 *
 * The last describe is the shell's other half of a band page: the mode a user
 * chose is held here, because the page itself unmounts when they visit another
 * destination.
 */

const READER: DeviceInfo = {
  vid: 0x1d6b,
  pid: 0x0242,
  product: "NFC-PM4",
  manufacturer: "PM4",
  serial: "0123456789",
};

/** Everything the shell asks for at launch that is not part of the failure. */
function quietAnswers() {
  return {
    library_load: () => libraryView(),
    beep: () => null,
  };
}

afterEach(() => {
  toastStore.clear();
});

describe("a Reader that stops answering", () => {
  it("arrives as a message and not as a strip in the page flow", async () => {
    fakeBackend({
      ...quietAnswers(),
      connect: () => {
        throw "I/O Timeout: the reader stopped answering";
      },
    });

    renderUi(<App />);

    const message = await screen.findByRole("status");
    expect(within(message).getByText("The Reader stopped responding")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss: The Reader stopped responding" })).toBeTruthy();

    // Nothing shoved the page down: the content column holds none of this.
    const main = document.querySelector("main");
    expect(main?.textContent ?? "").not.toContain("The Reader stopped responding");
  });

  it("is dismissed from the message, and stays dismissed", async () => {
    fakeBackend({
      ...quietAnswers(),
      connect: () => {
        throw "I/O Timeout: the reader stopped answering";
      },
    });
    const { user } = renderUi(<App />);

    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: /Dismiss: The Reader stopped responding/ }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reconnects from the message", async () => {
    const backend = fakeBackend({
      ...quietAnswers(),
      connect: () => {
        throw "I/O Timeout: the reader stopped answering";
      },
    });
    const { user } = renderUi(<App />);

    await screen.findByRole("status");
    // The launch attempt, then the one the message offers.
    expect(backend.callsTo("connect")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(backend.callsTo("connect")).toHaveLength(2);
  });

  it("says what to do when no Reader is attached", async () => {
    fakeBackend({
      ...quietAnswers(),
      connect: () => {
        throw "no such device: failed to open the reader";
      },
    });

    renderUi(<App />);

    const message = await screen.findByRole("status");
    expect(within(message).getByText("No Reader attached")).toBeTruthy();
    expect(message.textContent).toContain("Plug the NFC-PM4 Reader");
  });
});

describe("a Reader that connects", () => {
  it("reports nothing, because connecting is background work", async () => {
    fakeBackend({
      ...quietAnswers(),
      connect: () => READER,
      firmware_version: () => "H00S07",
    });

    renderUi(<App />);

    await waitFor(() => {
      expect(screen.getByText("H00S07")).toBeTruthy();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a condition that stays true", () => {
  it("stays inline in the page and never becomes a message", async () => {
    fakeBackend({
      ...quietAnswers(),
      connect: () => READER,
      firmware_version: () => "H00S07",
      library_load: () => ({
        ...libraryView(),
        // A lock and a migration warning are states the user is in, not events.
        problem: { kind: "unreadable", message: "The file could not be read.", detail: null },
        migrationWarning: "The lift from schema 1 failed.",
      }),
    });
    const { user } = renderUi(<App />);

    await user.click(screen.getByRole("button", { name: "Library" }));

    const main = document.querySelector("main");
    await waitFor(() => {
      expect(main?.textContent).toContain("The library file could not be read");
    });
    expect(main?.textContent).toContain("This library was upgraded from an older version");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a band page's mode", () => {
  it("is remembered while the app is open, because the shell holds it", async () => {
    fakeBackend({
      ...quietAnswers(),
      connect: () => READER,
      firmware_version: () => "H00S07",
    });
    const { user } = renderUi(<App />);

    await user.click(screen.getByRole("button", { name: "13.56 MHz" }));
    const modes = () => screen.getByRole("group", { name: "13.56 MHz mode" });
    await user.click(within(modes()).getByRole("button", { name: "Memory" }));
    expect(screen.getByText("Memory dump")).toBeTruthy();

    // Leaving the destination unmounts the page. Coming back returns to the mode
    // the user left, rather than to Read every time.
    await user.click(screen.getByRole("button", { name: "Library" }));
    await user.click(screen.getByRole("button", { name: "13.56 MHz" }));

    expect(
      within(modes()).getByRole("button", { name: "Memory" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("Memory dump")).toBeTruthy();
  });
});
