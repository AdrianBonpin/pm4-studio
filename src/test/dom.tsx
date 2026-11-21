/**
 * The DOM harness: a jsdom document, a fake Tauri IPC boundary, and cleanup.
 *
 * Not a test file itself — it is the fixture the component tests beside the
 * pages and components share. The Vitest config keeps `environment: "node"` for
 * the pure logic tests, and each component test opts into jsdom with a
 * `@vitest-environment jsdom` docblock, so the other tests stay as fast as they
 * were.
 *
 * What is faked, and what is not
 * ------------------------------
 * The only thing replaced is the boundary the app reaches the backend through.
 * `@tauri-apps/api/core`'s `invoke` is a one-line delegate:
 *
 *     async function invoke(cmd, args, options) {
 *       return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
 *     }
 *
 * so `window.__TAURI_INTERNALS__.invoke` is exactly where the webview stops and
 * Rust begins. Standing a fake there means every module between a control and
 * the backend — the component, its hooks, the IPC wrapper — runs unmodified,
 * and a test sees the same command names and arguments the shipped app sends.
 * Nothing app-internal is mocked, and no module is replaced.
 *
 * The fake also makes `isTauri()` true, which is what the hooks check before
 * reading the library file. That is not a convenience: without it a component
 * would report "this preview cannot reach the library" and no gate above a
 * store call could be exercised at all.
 *
 * No Reader is attached and no backend runs: every command is answered by the
 * test, from values written down in the test.
 */

import type { ReactElement } from "react";
import { afterEach } from "vitest";
import { cleanup, render, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { resetDeviceOperationsForTest } from "../lib/deviceLock";
import { resetSessionModesForTest } from "../hooks/useSessionMode";

/** One command the interface sent to the backend. */
export interface SentCommand {
  /** The Tauri command name, as `invoke` was called with it. */
  readonly command: string;
  /** The arguments, as written down in the test or produced by the component. */
  readonly args: Record<string, unknown>;
}

/** What the fake answers one command with, given the arguments it arrived with. */
export type CommandAnswer = (args: Record<string, unknown>) => unknown;

/** The fake backend, plus the record of what the interface asked it to do. */
export interface Backend {
  /** Every command sent, in order. */
  readonly calls: SentCommand[];
  /** Every command of one name, in order — `callsTo("lf_write")[0]`. */
  callsTo(command: string): SentCommand[];
  /** Answer one command differently for the rest of the test. */
  answer(command: string, reply: CommandAnswer): void;
}

interface FakeIpc {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  transformCallback(callback: unknown): unknown;
  /**
   * What the webview knows about the window it is in. `getCurrentWindow()` reads
   * the label from here before it sends anything, so a component that intercepts
   * the close request needs it to exist. One window, named as the capability
   * names it.
   */
  metadata: {
    currentWindow: { label: string };
    currentWebview: { windowLabel: string; label: string };
  };
}

/**
 * What the event plugin answers before a test says otherwise.
 *
 * Registering and unregistering a listener is plumbing `@tauri-apps/api` does on
 * its own the moment a page listens for anything: it is not a command the app
 * chose to send, and a page that listens would fail on mount without it. The
 * calls are still recorded with the rest, so a test that wants to see them can.
 * Every command the app itself issues — the window actions included — still has
 * to be scripted.
 */
const EVENT_PLUGIN_ANSWERS: Record<string, CommandAnswer> = {
  "plugin:event|listen": () => 1,
  "plugin:event|unlisten": () => null,
};

/**
 * Install the fake backend at the IPC boundary and return its call log.
 *
 * Commands with no answer reject, so a test cannot pass by accident on a call
 * nobody scripted: the default is a loud failure, not `undefined`.
 */
export function fakeBackend(answers: Record<string, CommandAnswer> = {}): Backend {
  const handlers = new Map(Object.entries({ ...EVENT_PLUGIN_ANSWERS, ...answers }));
  const calls: SentCommand[] = [];

  const ipc: FakeIpc = {
    async invoke(command, args = {}) {
      calls.push({ command, args });
      const handler = handlers.get(command);
      if (!handler) {
        throw new Error(
          `the fake backend has no answer for "${command}" — script it with answer()`,
        );
      }
      return await handler(args);
    },
    // Only `Channel` construction needs this, and nothing under test uses one.
    transformCallback: (callback) => callback,
    // The one window `tauri.conf.json` declares: `getCurrentWindow()` reads the
    // label from here, and the window it hands back sends its commands under it.
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
  };

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: ipc,
    writable: true,
    configurable: true,
  });

  // The webview's other half of event listening, installed beside the IPC
  // boundary by Tauri itself. `unlisten` calls it directly rather than through a
  // command, so a component that unregisters on unmount reaches it first. Nothing
  // is registered here — `transformCallback` above hands the handler straight
  // back — so there is nothing to drop.
  Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
    value: { unregisterListener: (_event: string, _eventId: number) => {} },
    writable: true,
    configurable: true,
  });

  return {
    calls,
    callsTo: (command) => calls.filter((call) => call.command === command),
    answer: (command, reply) => {
      handlers.set(command, reply);
    },
  };
}

/** A rendered component, with a user able to click and type at it. */
export interface Ui extends RenderResult {
  readonly user: UserEvent;
}

/**
 * Render one component into jsdom and return a user driving it.
 *
 * `user` rather than raw events: the buttons in this app are disabled while an
 * operation is in flight, and a click on a disabled button is a click the real
 * webview would not deliver either.
 */
export function renderUi(ui: ReactElement): Ui {
  const user = userEvent.setup();
  return { ...render(ui), user };
}

afterEach(() => {
  cleanup();
  // A component that did not release the Reader (an unmount mid-operation, a
  // rejected call) must not leave the next test's poller waiting on the flag.
  resetDeviceOperationsForTest();
  // A band page remembers the mode you were on for the length of a session. The
  // session belongs to the webview, so one test's mode must not be the next
  // test's default — a fresh test starts where a fresh launch would.
  resetSessionModesForTest();
  // The boundary belongs to the webview, not to the test runner: leaving it
  // behind would make `isTauri()` true in a test that never asked for it.
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  delete (window as { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown })
    .__TAURI_EVENT_PLUGIN_INTERNALS__;
});
