// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { ToolsPage } from "./ToolsPage";
import { fakeBackend, renderUi, type Backend, type Ui } from "../test/dom";
import {
  BUILD_REFUSAL_DETAIL,
  BUILD_REFUSAL_LABEL,
  READ_ONLY_TITLE,
} from "../lib/consoleRefusal";
import type { ConsoleCapability, RawResponse } from "../types";

/**
 * The raw console's command boundary (ADR 0006, Story 60).
 *
 * The console is the instrument that produced every verified frame in
 * `PROTOCOL.md`, and it sends whatever frame it is typed — including `0x0073`
 * and `0x0082`, which reach past every write guard. A release build therefore
 * sends only commands that cannot change a Tag; a debug build sends anything.
 *
 * What these tests hold to the boundary:
 *   - the console says it is read-only before it is used, from the capability
 *     the backend reports rather than from an assumption of its own;
 *   - a refused frame is shown as a limit of the build, naming the command;
 *   - a device failure is not dressed up as a build refusal, because the two
 *     are different news about different things;
 *   - a debug build is told it is not read-only and its write frame is sent.
 *
 * The backend is faked at `window.__TAURI_INTERNALS__.invoke`, so everything
 * between the frame box and the wire runs unmodified. The refusal message here
 * is the wording `src-tauri/src/console.rs` produces; that module's own tests
 * own the phrasing.
 */

/** The capability a release build reports: eight commands, none of them writes. */
const READ_ONLY: ConsoleCapability = {
  readOnly: true,
  commands: [
    { cmd: "0x0051", name: "wake / select" },
    { cmd: "0x0053", name: "beep and LED on" },
    { cmd: "0x0054", name: "firmware version" },
    { cmd: "0x0055", name: "LED off" },
    { cmd: "0x0069", name: "13.56 MHz poll" },
    { cmd: "0x0072", name: "125 kHz read" },
    { cmd: "0x0081", name: "NTAG read" },
    { cmd: "0x0083", name: "NTAG info" },
  ],
};

/** The capability a development build reports: no limit, nothing listed. */
const FULL: ConsoleCapability = { readOnly: false, commands: [] };

/** The wake frame; a permitted command, so it is sent in either build. */
const WAKE_FRAME = "55 00 51 00 01 01 FE 01";
/** The 125 kHz write: the destructive 24-byte path, refused in a release build. */
const LF_WRITE_FRAME = "55 00 73 00 18 00 01 01 01 FE 01";

/** What a release build answers a refused frame with. */
const REFUSAL = {
  kind: "refusedByBuild",
  cmd: "0x0073",
  message:
    "this build sends only commands that cannot change a tag, so 0x0073 was refused. " +
    "Write experiments run in a development build — start it with `cargo run` from the " +
    "repository instead of opening the installed app.",
};

const REPLY: RawResponse = {
  sent: WAKE_FRAME,
  cmd: 0x0051,
  payload: "01 01",
  checksum_ok: true,
  raw: "0051  01 01",
};

/** Type a frame into the console and press Send. */
async function sendFrame(ui: Ui, hex: string) {
  const input = screen.getByPlaceholderText("55 00 51 00 01 01 FE 01");
  await ui.user.clear(input);
  await ui.user.type(input, hex);
  await ui.user.click(screen.getByRole("button", { name: "Send" }));
}

/** Render the console with a backend that reports one capability. */
function mountConsole(
  capability: ConsoleCapability,
  answers: Parameters<typeof fakeBackend>[0] = {},
): { backend: Backend; ui: Ui } {
  const backend = fakeBackend({
    console_capability: () => capability,
    raw_send: () => REPLY,
    ...answers,
  });
  const ui = renderUi(<ToolsPage connected />);
  return { backend, ui };
}

describe("the raw console in a release build", () => {
  it("says it is read-only before it is used, and lists what it does send", async () => {
    const { backend } = mountConsole(READ_ONLY);

    // On screen before any frame is typed, from the capability the backend
    // reported: this is a statement made up front, not a discovery.
    await screen.findByText(READ_ONLY_TITLE);
    expect(backend.callsTo("console_capability")).toHaveLength(1);
    expect(backend.callsTo("raw_send")).toHaveLength(0);

    // What it will send, named, so a user can see the reads survived.
    expect(screen.getByText(/0x0051 wake \/ select/)).toBeTruthy();
    expect(screen.getByText(/0x0083 NTAG info/)).toBeTruthy();
    expect(screen.getByPlaceholderText(WAKE_FRAME)).toBeTruthy();
  });

  it("shows a refused write as a limit of the build, naming the frame", async () => {
    const { backend, ui } = mountConsole(READ_ONLY, {
      raw_send: () => {
        throw REFUSAL;
      },
    });

    await sendFrame(ui, LF_WRITE_FRAME);

    const refusal = await screen.findByText(/0x0073 was refused/);
    // The frame went to the backend: the refusal is the backend's, and the
    // console reports it rather than swallowing it or retrying.
    expect(backend.callsTo("raw_send")[0]?.args).toEqual({ hex: LF_WRITE_FRAME });
    expect(refusal.textContent).toContain("development build");
    // Labelled as the build's refusal, with the difference from a guard
    // refusal stated: one is about the build, the other about the Tag.
    expect(screen.getByText(BUILD_REFUSAL_LABEL)).toBeTruthy();
    expect(screen.getByText(BUILD_REFUSAL_DETAIL)).toBeTruthy();
  });

  it("does not dress a device failure as a build refusal", async () => {
    const { ui } = mountConsole(READ_ONLY, {
      raw_send: () => {
        throw "could not read the tag on the reader";
      },
    });

    await sendFrame(ui, WAKE_FRAME);

    // The device's own words, in the plain error line — and no build label,
    // which belongs to the other kind of refusal.
    await screen.findByText("could not read the tag on the reader");
    expect(screen.queryByText(BUILD_REFUSAL_LABEL)).toBeNull();
    expect(screen.queryByText(BUILD_REFUSAL_DETAIL)).toBeNull();
  });

  it("still sends a permitted frame, so the instrument still works for diagnosis", async () => {
    const { backend, ui } = mountConsole(READ_ONLY);

    await sendFrame(ui, WAKE_FRAME);

    await waitFor(() => {
      expect(backend.callsTo("raw_send")).toHaveLength(1);
    });
    expect(backend.callsTo("raw_send")[0]?.args).toEqual({ hex: WAKE_FRAME });
    // The reply is on screen, decoded as it always was.
    expect(await screen.findByText("01 01")).toBeTruthy();
  });
});

describe("the raw console in a development build", () => {
  it("shows no read-only warning, because it has no such limit", async () => {
    const { backend, ui } = mountConsole(FULL);

    // The console asked the backend rather than assuming either mode.
    await waitFor(() => {
      expect(backend.callsTo("console_capability")).toHaveLength(1);
    });
    expect(screen.queryByText(READ_ONLY_TITLE)).toBeNull();

    await sendFrame(ui, LF_WRITE_FRAME);

    // The write frame is sent, unchanged: protocol work continues from a
    // development build, and the console does not pre-empt it.
    await waitFor(() => {
      expect(backend.callsTo("raw_send")).toHaveLength(1);
    });
    expect(backend.callsTo("raw_send")[0]?.args).toEqual({ hex: LF_WRITE_FRAME });
    expect(screen.queryByText(READ_ONLY_TITLE)).toBeNull();
    expect(screen.queryByText(BUILD_REFUSAL_LABEL)).toBeNull();
  });
});

describe("Tools holds the console and nothing else", () => {
  it("carries no indicator test and no capability limits, because both moved to Settings", async () => {
    // ADR 0006 keeps Tools a visible destination so the release console's
    // honesty is not buried. What it does not keep is everything else that used
    // to be piled on it: the indicator test and the Reader's limits now live in
    // Settings → Diagnostics, where a limitation is stated once.
    const { backend } = mountConsole(READ_ONLY);
    await screen.findByText(READ_ONLY_TITLE);

    expect(screen.queryByText("Indicator")).toBeNull();
    expect(screen.queryByText("Capability limits")).toBeNull();
    // Nothing on this page sends the LED-off frame any more; the frame is still
    // typable into the console, which is the point of the console.
    expect(backend.callsTo("led_off")).toHaveLength(0);
  });
});
