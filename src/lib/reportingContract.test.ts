/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * ADR 0008, guarded at the source: there is one way to make a sound.
 *
 * `src/reporting.test.tsx` proves that every operation the vocabulary names
 * reports itself. This file proves the other half — that reporting is the *only*
 * route to the beeper — because a second route that no test drives is exactly the
 * defect ticket 17 removed: a component handed a callback that chirps, wired or
 * not, kept for a call site nobody finished.
 *
 * It reads the app's own source, which is the only way to assert that something
 * does not exist in a surface no test renders. Three absences and one presence:
 *
 *   1. no module declares a sound-making callback prop (`onChirp`, `onBeep`,
 *      `onSignal`, `onSound`), and the retired `onChirp`/`legacyChirp` names are
 *      gone from the tree;
 *   2. `emitSignal` — the one function that hands a symbol to the player — is
 *      called from `lib/outcome.ts` and nowhere else, so every sound in the app
 *      leaves through `report(outcome)`;
 *   3. the two frames that make a sound (`beep`) and release the LED are sent from
 *      `hooks/useBeep.ts` and nowhere else, so no component can reach the hardware
 *      directly;
 *   4. the player subscribes; it does not emit, which is what keeps the shell's
 *      one subscriber from becoming a second source.
 *
 * The scans are deliberately narrow. They fail on a *declared prop* and on a
 * *call*, not on the word "chirp": the alphabet is allowed to talk about chirps,
 * because chirps are what the symbols are made of.
 */

/**
 * Every app source file, as text, minus the tests.
 *
 * The same `?raw` glob the writability guard uses, rather than a Node-only `fs`
 * walk: a guard on the shipped app should read what the bundler reads. Test files
 * are excluded because a test may name the thing it is asserting the absence of.
 */
const SOURCES = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every module's text, keyed by its path relative to the repository root. */
const MODULES = Object.entries(SOURCES).map(([path, text]) => ({
  // The glob is relative to this file's directory: `./outcome.ts` is
  // `src/lib/outcome.ts` and `../hooks/useBeep.ts` is `src/hooks/useBeep.ts`.
  // Naming them as the repository does keeps a failure readable and keeps the
  // constants below honest.
  path: path.startsWith("./") ? `src/lib/${path.slice(2)}` : path.replace(/^\.\.\//, "src/"),
  text,
}));

/** The modules that may name a sound. */
const SEAM = "src/lib/outcome.ts";
const SIGNAL = "src/lib/signal.ts";
const PLAYER = "src/hooks/useBeep.ts";

/** Every call site of `name` in the tree, as `module: line`. */
function callSites(name: string): string[] {
  const call = new RegExp(`(^|[^\\w.])${name}\\s*\\(`);
  const declaration = new RegExp(`(function|const|let|var)\\s+${name}\\b`);
  const found: string[] = [];
  for (const { path, text } of MODULES) {
    text.split("\n").forEach((line, at) => {
      // Comments describe the seam and are not a way into it, and the module that
      // defines the function is not a call site of it.
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (declaration.test(code)) return;
      if (call.test(code)) found.push(`${path}:${at + 1}`);
    });
  }
  return found;
}

describe("the app's source, read rather than assumed", () => {
  it("is found, so an empty scan cannot pass as a clean one", () => {
    expect(MODULES.length).toBeGreaterThan(30);
    expect(MODULES.some((m) => m.path === "src/App.tsx")).toBe(true);
    expect(MODULES.some((m) => m.path === PLAYER)).toBe(true);
    expect(MODULES.some((m) => m.path === SEAM)).toBe(true);
  });
});

describe("no component receives a callback that makes a sound", () => {
  it("declares no chirp, beep, signal or sound prop anywhere", () => {
    // A prop is a promise: anything shaped like one of these would be a second
    // route to the beeper whether or not anything calls it yet — which is how the
    // path this ticket deletes arrived in the first place.
    const soundProp = /\bon[A-Z][A-Za-z0-9]*\??\s*:\s*\([^)]*\)\s*=>/g;
    const offending: string[] = [];
    for (const { path, text } of MODULES) {
      for (const match of text.matchAll(soundProp)) {
        const declaration = match[0];
        if (!/(chirp|beep|signal|sound|buzz)/i.test(match[0])) continue;
        offending.push(`${path}: ${declaration.replace(/\s+/g, " ")}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it("keeps the retired names out of the tree entirely", () => {
    // `onChirp` was the prop, `legacyChirp` the compatibility helper behind it.
    // Both are deleted, not dormant: a rename that kept either name would leave
    // the second path one import away from coming back.
    const retired = /(\bonChirp\b|\blegacyChirp\b|\buseBeep\(\)[^\n]*\bchirp\b)/;
    const offending = MODULES.filter(({ text }) => retired.test(text)).map(({ path }) => path);
    expect(offending).toEqual([]);
  });
});

describe("the beeper is reachable only through the outcome seam", () => {
  it("is handed symbols by `report` and by nothing else", () => {
    // `emitSignal` is the door to the audible channel. One caller means one way
    // in, and that caller is the seam that also writes the message.
    const sites = callSites("emitSignal");
    expect(sites.map((site) => site.split(":")[0])).toEqual([SEAM]);
    expect(sites).toHaveLength(1);
  });

  it("sends its two frames from the hook that subscribes, and from no component", () => {
    // The chirp frame and the LED release are the only two things that can make
    // the hardware audible. Both belong to the player.
    //
    // The LED frame is not a sound — the alphabet calls it a release, not a beep
    // — and Diagnostics keeps its own frame-level probe for it, which is stated
    // where the probe is offered. The beep frame is the sound, and it is the
    // player's alone.
    const beepFrames = commandsSent("beep");
    expect(beepFrames.map((site) => site.split(":")[0])).toEqual([PLAYER]);
    const ledFrames = commandsSent("led_off");
    expect(ledFrames.map((site) => site.split(":")[0]).sort()).toEqual(
      [PLAYER, "src/pages/SettingsPage.tsx"].sort(),
    );
  });

  it("subscribes to signals rather than emitting them", () => {
    // The shell's one subscriber must stay a subscriber: a hook that emitted
    // would be a second source of sound, and every outcome would arrive twice.
    const player = MODULES.find((m) => m.path === PLAYER);
    expect(player?.text).toMatch(/subscribeSignals\(/);
    expect(player?.text).not.toMatch(/\bemitSignal\s*\(/);
    expect(SIGNAL).toBe("src/lib/signal.ts");
  });

  it("leaves the alphabet itself free to say how many chirps a symbol is", () => {
    // A guard that failed on the word "chirp" would forbid the one module whose
    // job is to define it, and would be deleted rather than fixed.
    const sequence = MODULES.find((m) => m.path === "src/lib/chirpSequence.ts");
    expect(sequence?.text).toMatch(/chirps/);
  });
});

/** Every `invoke("cmd"` call site, as `module: line`. */
function commandsSent(command: string): string[] {
  const pattern = new RegExp(`invoke(?:<[^>]*>)?\\(\\s*"${command}"`);
  const found: string[] = [];
  for (const { path, text } of MODULES) {
    text.split("\n").forEach((line, at) => {
      if (pattern.test(line)) found.push(`${path}:${at + 1}`);
    });
  }
  return found;
}
