// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import { fakeBackend, renderUi, type Backend } from "../test/dom";
import { libraryState } from "../test/libraryState";
import { APP_VERSION, CREDITS, LICENCE, REPOSITORY_URL } from "../lib/appInfo";
import { READER_CAPABILITY_LIMITS } from "../lib/readerIdentity";
import { QUIET_LEVEL_LABEL, type QuietLevel } from "../lib/quietLevel";
import { TOAST_CORNER_KEY } from "../lib/toastCorner";
import { toastStore } from "../lib/toastStore";
import type { DeviceInfo } from "../types";

/**
 * Settings: three groups, one click apart, and the facts that used to be
 * scattered across the sidebar and every page's footer.
 *
 * The page is a leaf. It receives the Reader summary and the quiet level as
 * props, because both are the shell's state: a Settings page that reached for the
 * beeper itself would be a second subscriber and would double every signal
 * (ADR 0008).
 *
 * What these tests hold:
 *   - Feedback opens first, and About and Diagnostics are one click from it;
 *   - the quiet level is three-way and works with no Reader attached, because the
 *     preference is stored locally and has nothing to do with the hardware;
 *   - the beep test reports what it actually did: a signal was sent, or nothing
 *     was, and never that a chirp was heard;
 *   - both indicator actuators report through the seam, so a sent frame and a
 *     failed one are two different results;
 *   - the message corner is chosen here and is remembered;
 *   - About states the version, the credits, the repository, the licence and the
 *     Reader's own identity, including when there is no Reader;
 *   - Diagnostics holds the indicator test and the capability limits, so the
 *     limits are stated once instead of against every tag.
 */

const READER_INFO: DeviceInfo = {
  vid: 0x1d6b,
  pid: 0x0242,
  product: "NFC-PM4",
  manufacturer: "PM4 Technologies",
  serial: "0123456789",
};

interface MountOptions {
  quietLevel?: QuietLevel;
  onQuietLevelChange?: (level: QuietLevel) => void;
  connected?: boolean;
  info?: DeviceInfo | null;
  firmware?: string | null;
  answers?: Parameters<typeof fakeBackend>[0];
}

function mount(options: MountOptions = {}) {
  const {
    quietLevel = "all",
    onQuietLevelChange = () => {},
    connected = true,
    info = READER_INFO,
    firmware = "H00S07",
    answers = {},
  } = options;
  const backend: Backend = fakeBackend({ led_off: () => null, beep: () => null, ...answers });
  const ui = renderUi(
    <SettingsPage
      reader={{ connected, info, firmware }}
      quietLevel={quietLevel}
      onQuietLevelChange={onQuietLevelChange}
      library={libraryState()}
    />,
  );
  return { backend, ui };
}

/** The settings-group switch, so each test can move around it the way a user does. */
function groupSwitch() {
  return screen.getByRole("group", { name: "Settings group" });
}

beforeEach(() => {
  localStorage.clear();
  toastStore.clear();
});

describe("the Settings page's shape", () => {
  it("opens on Feedback, with Data, About and Diagnostics one click away", async () => {
    const { ui } = mount();

    // Feedback is open before anything is clicked: the page has a default, not
    // an empty state to choose from.
    const switchGroup = groupSwitch();
    expect(within(switchGroup).getByRole("button", { name: "Feedback" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("group", { name: "Quiet level" })).toBeTruthy();

    // Each of the other groups is one click, not a scroll: the switcher shows
    // one group at a time and every group is on it.
    expect(within(switchGroup).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Feedback",
      "Data",
      "About",
      "Diagnostics",
    ]);

    await ui.user.click(within(switchGroup).getByRole("button", { name: "About" }));
    expect(screen.getByText(APP_VERSION)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Quiet level" })).toBeNull();

    await ui.user.click(within(switchGroup).getByRole("button", { name: "Diagnostics" }));
    expect(screen.getByText("Capability limits")).toBeTruthy();
    expect(screen.queryByText(APP_VERSION)).toBeNull();
  });
});

describe("Feedback", () => {
  it("offers three quiet levels and changes them with no Reader attached", async () => {
    const onQuietLevelChange = vi.fn();
    const { ui } = mount({
      connected: false,
      info: null,
      firmware: null,
      onQuietLevelChange,
    });

    const levels = screen.getByRole("group", { name: "Quiet level" });
    // The preference is this machine's, not the hardware's: an unplugged Reader
    // must not take the control away, and it is the same three choices either way.
    expect(within(levels).getAllByRole("button").map((b) => b.textContent)).toEqual([
      QUIET_LEVEL_LABEL.off,
      QUIET_LEVEL_LABEL["errors-and-warnings"],
      QUIET_LEVEL_LABEL.all,
    ]);
    expect(
      (within(levels).getByRole("button", { name: QUIET_LEVEL_LABEL.all }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    await ui.user.click(within(levels).getByRole("button", { name: QUIET_LEVEL_LABEL.off }));
    expect(onQuietLevelChange).toHaveBeenCalledWith("off");
  });

  it("marks the current level, and says what it will do", () => {
    mount({ quietLevel: "errors-and-warnings" });

    const levels = screen.getByRole("group", { name: "Quiet level" });
    expect(
      within(levels)
        .getByRole("button", { name: QUIET_LEVEL_LABEL["errors-and-warnings"] })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // A level is chosen by what it will do, not by its name.
    expect(screen.getByText(/Two chirps when a result needs checking/)).toBeTruthy();
  });

  it("remembers which corner the messages appear in", async () => {
    const { ui } = mount();

    const corners = screen.getByRole("group", { name: "Messages appear in" });
    expect(within(corners).getByRole("button", { name: "Bottom right" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    await ui.user.click(within(corners).getByRole("button", { name: "Top left" }));

    // Stored, so choosing a corner and restarting does not put the messages back.
    expect(localStorage.getItem(TOAST_CORNER_KEY)).toBe("top-left");
    expect(within(corners).getByRole("button", { name: "Top left" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(within(corners).getByRole("button", { name: "Bottom right" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("sounds the beeper test through the outcome seam, not around it", async () => {
    const { ui } = mount();

    await ui.user.click(screen.getByRole("button", { name: "Beep test" }));

    // The audible half is the shell's subscriber; what this page owns is the
    // outcome. It is a real outcome with a visible half, so the test never
    // sounds without saying something.
    await waitFor(() => {
      expect(toastStore.getState().toasts).toHaveLength(1);
    });
    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toBe("Signal sent.");
    // What was sent, not what was heard: the firmware never confirms the frame.
    expect(toast?.message ?? "").not.toMatch(/heard|sounded/i);
    expect(toast?.detail ?? "").toMatch(/never confirms/i);
  });

  it("reports honestly when there is no Reader to send a signal to", async () => {
    const { ui } = mount({ connected: false, info: null, firmware: null });

    await ui.user.click(screen.getByRole("button", { name: "Beep test" }));

    const [toast] = toastStore.getState().toasts;
    // Nothing was sent, so nothing may be claimed: not a chirp, and not even the
    // frame that the connected case sends.
    expect(toast?.message).toBe("No signal was sent.");
    // An unplugged Reader is a state, not a fault, so this is informational and
    // silent: there is no chip to have chirped, and two chirps on every launch is
    // not news.
    expect(toast?.severity).toBe("info");
    expect(toast?.detail ?? "").toMatch(/Reader attached/);
    expect(`${toast?.message} ${toast?.detail}`).not.toMatch(/heard|sounded/i);
  });

  it("says the quiet level muted the test rather than claiming a chirp", async () => {
    const { ui } = mount({ quietLevel: "off" });

    await ui.user.click(screen.getByRole("button", { name: "Beep test" }));

    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toBe("No signal was sent.");
    // Silence is what the preference asked for, so the report is a statement of
    // fact rather than a failure — and it is not a signal either.
    expect(toast?.severity).toBe("info");
    expect(toast?.detail ?? "").toContain(QUIET_LEVEL_LABEL.off);
    expect(`${toast?.message} ${toast?.detail}`).not.toMatch(/heard|sounded/i);
  });
});

describe("About", () => {
  it("states the version, the repository, the licence and the credits", async () => {
    const { ui } = mount();
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "About" }));

    // A user reporting a problem needs to be able to say which build it was.
    expect(screen.getByText(APP_VERSION)).toBeTruthy();
    expect(screen.getByRole("link", { name: REPOSITORY_URL }).getAttribute("href")).toBe(
      REPOSITORY_URL,
    );
    expect(screen.getByText(LICENCE)).toBeTruthy();
    for (const credit of CREDITS) {
      expect(screen.getByRole("link", { name: credit.name }).getAttribute("href")).toBe(credit.url);
    }
  });

  it("states the Reader's own identity, which used to clutter the working pages", async () => {
    const { ui } = mount();
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "About" }));

    expect(screen.getByText(READER_INFO.product)).toBeTruthy();
    expect(screen.getByText(READER_INFO.manufacturer)).toBeTruthy();
    expect(screen.getByText(READER_INFO.serial)).toBeTruthy();
    expect(screen.getByText("H00S07")).toBeTruthy();
  });

  it("says there is no Reader in words, rather than showing blanks", async () => {
    const { ui } = mount({ connected: false, info: null, firmware: null });
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "About" }));

    // An absence is stated as a sentence: a blank value reads as a rendering bug.
    expect(screen.getAllByText("no reader").length).toBeGreaterThan(0);
    expect(screen.getByText("not connected")).toBeTruthy();
  });
});

describe("Diagnostics", () => {
  it("holds the indicator test, and reports the LED-off frame through the seam", async () => {
    const { backend, ui } = mount();
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "Diagnostics" }));

    await ui.user.click(screen.getByRole("button", { name: /LED off/ }));

    await waitFor(() => {
      expect(backend.callsTo("led_off")).toHaveLength(1);
    });
    // Both actuators report the same way: one outcome through the seam, so the
    // result is not a line of the page's own state (ADR 0008).
    const [toast] = toastStore.getState().toasts;
    expect(toast?.kind).toBe("led-off");
    // What was sent, not what was seen: the frames are fire-and-forget.
    expect(toast?.message).toBe("LED off sent.");
    expect(toast?.detail ?? "").toMatch(/not a beep/);
    // And silent: 0x0055 is the LED-off frame, so it must not chirp.
    expect(toast?.severity).toBe("info");
  });

  it("reports an LED-off frame that could not be sent as a failure, never as sent", async () => {
    // The old version of this test could not tell these two apart: both were a
    // string in local state.
    const { ui } = mount({
      answers: {
        led_off: () => {
          throw new Error("I/O Timeout: the reader stopped answering");
        },
      },
    });
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "Diagnostics" }));

    await ui.user.click(screen.getByRole("button", { name: /LED off/ }));

    await waitFor(() => expect(toastStore.getState().toasts).toHaveLength(1));
    const [toast] = toastStore.getState().toasts;
    expect(toast?.kind).toBe("reader-wedged");
    expect(toast?.message).toBe("The Reader stopped responding");
    expect(screen.queryByText(/LED off sent/)).toBeNull();
  });

  it("states the capability limits once, in the one place that owns them", async () => {
    const { ui } = mount();
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "Diagnostics" }));

    expect(screen.getByText("Capability limits")).toBeTruthy();
    for (const limit of READER_CAPABILITY_LIMITS) {
      expect(screen.getByText(limit.label)).toBeTruthy();
    }
  });

  it("says the Reader must be attached rather than leaving dead controls", async () => {
    const { ui } = mount({ connected: false, info: null, firmware: null });
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "Diagnostics" }));

    expect(screen.getByText(/Plug in the Reader to run the indicator test/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /LED off/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not claim a chirp when the quiet level declined to play the indicator's beep", async () => {
    const { ui } = mount({ quietLevel: "off" });
    await ui.user.click(within(groupSwitch()).getByRole("button", { name: "Diagnostics" }));

    await ui.user.click(screen.getByRole("button", { name: /Beep/ }));

    const [toast] = toastStore.getState().toasts;
    expect(toast?.message).toBe("No signal was sent.");
    expect(toast?.detail ?? "").toContain(QUIET_LEVEL_LABEL.off);
  });
});
