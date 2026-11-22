// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DeviceStubInProductionError,
  installDeviceStub,
  readProfiles,
  resetDeviceStubForTest,
  sentCommands,
  STUB_MODULE_MARKER,
} from "./deviceStub";
import { DEVICE_FIXTURE_MARKER } from "../lib/deviceBoundary";

/**
 * The verification stub, tested for the two things that make it safe to have.
 *
 * It is a development tool that answers at the boundary the app reaches Rust
 * through, so the things that matter about it are not its fixtures. They are:
 *
 *   1. in a production build it refuses to install, touching nothing — no
 *      `__TAURI_INTERNALS__`, no marker, no fixture — so a release build that
 *      reached it has no backend rather than a pretend one; and
 *   2. in a development build it installs where the app expects, answers the
 *      commands the pages send, and rejects anything unscripted loudly instead of
 *      returning `undefined` into a page that then looks fine.
 *
 * The absence of the module from a release bundle is a build-level fact and is
 * checked by grepping the built bundle for `STUB_MODULE_MARKER`, not here.
 */

afterEach(() => {
  resetDeviceStubForTest();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (window as { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown })
    .__TAURI_EVENT_PLUGIN_INTERNALS__;
  delete (window as { [DEVICE_FIXTURE_MARKER]?: unknown })[DEVICE_FIXTURE_MARKER];
});

describe("a production build", () => {
  it("refuses to install, and leaves no boundary behind", () => {
    expect(() =>
      installDeviceStub({ production: true, panel: false, search: "" }),
    ).toThrow(DeviceStubInProductionError);

    // Nothing was installed: a release build that reached this module has no
    // device boundary at all, which is what "no Reader" actually means.
    expect((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__).toBeUndefined();
    expect(
      (window as { [DEVICE_FIXTURE_MARKER]?: unknown })[DEVICE_FIXTURE_MARKER],
    ).toBeUndefined();
  });

  it("says why on screen rather than failing silently", () => {
    document.body.innerHTML = '<div id="root"></div>';
    expect(() =>
      installDeviceStub({ production: true, panel: false, search: "" }),
    ).toThrow(DeviceStubInProductionError);

    const notice = document.querySelector('[data-device-boundary="fixture-in-release-build"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("This build will not run");
    expect(notice?.textContent).toContain("fixture");
  });
});

describe("a development build", () => {
  it("installs at the IPC boundary and marks the window", () => {
    installDeviceStub({ production: false, panel: false, search: "" });

    expect((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__).toBeDefined();
    const marker = (
      window as unknown as { [DEVICE_FIXTURE_MARKER]?: { module: string } }
    )[DEVICE_FIXTURE_MARKER];
    expect(marker?.module).toBe(STUB_MODULE_MARKER);
  });

  it("answers the commands the pages send with the fixtures they expect", async () => {
    installDeviceStub({ production: false, panel: false, search: "" });
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: object) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__.invoke;

    const info = (await invoke("connect")) as { product: string };
    expect(info.product).toBe("NFC-PM4");

    const tag = (await invoke("lf_poll")) as { id: string } | null;
    expect(tag?.id).toBe("55 00 84 82 12");

    const poll = (await invoke("hf_poll")) as { payload: number[] } | null;
    // The NTAG215 capture from the spec: a 7-byte UID at byte 12.
    expect(poll?.payload).toHaveLength(19);
    expect(poll?.payload[12]).toBe(0x07);
  });

  it("refuses a command it has no answer for, rather than answering undefined", async () => {
    installDeviceStub({ production: false, panel: false, search: "" });
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__.invoke;

    await expect(invoke("nothing_registers_this")).rejects.toThrow(/no answer/);
  });

  it("reports what the interface sent, in order", async () => {
    installDeviceStub({ production: false, panel: false, search: "" });
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__.invoke;

    sentCommands.length = 0;
    await invoke("beep");
    await invoke("led_off");
    expect(sentCommands.map((c) => c.command)).toEqual(["beep", "led_off"]);
  });
});

describe("the field profiles a screenshot is reproduced from", () => {
  it("reads the two parameters the verification entry documents", () => {
    expect(readProfiles("?lf=blank&hf=classic")).toEqual({ lf: "blank", hf: "classic" });
  });

  it("falls back to the documented defaults for anything it does not know", () => {
    expect(readProfiles("")).toEqual({ lf: "source", hf: "ntag" });
    expect(readProfiles("?lf=nonsense&hf=nonsense")).toEqual({ lf: "source", hf: "ntag" });
  });
});
