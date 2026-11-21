/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { READER_CAPABILITY_LIMITS } from "./readerIdentity";

/**
 * ADR 0007, guarded: the app never offers a writability probe.
 *
 * Every candidate probe is a write. One that changes the tag is destructive by
 * definition, and the only write that leaves content unchanged writes the tag's
 * own Identity back to it — which is precisely the ordering this project
 * identifies as having permanently locked a T5577. So there is no third option,
 * and the decision is not "not built yet" but "not buildable".
 *
 * A decision like that decays the way all absences do: someone later adds a
 * reassuring "Check first" button because the absence looks like an oversight.
 * This file is the thing that fails when they do. It reads the app's own source —
 * the only way to assert that something does not exist in a surface no test
 * renders — and it is deliberately narrow: it fails on a *command* or an
 * *exported function* that would answer the writability question, not on the word
 * "writability", because the app must be free to state the limit in words.
 */

/**
 * Every app source file, as text, minus the tests.
 *
 * The same `?raw` glob the button-variant guard uses, rather than a Node-only
 * `fs` walk: a guard on the shipped app should read what the bundler reads.
 */
const SOURCES = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Every Tauri command the interface sends, read out of the `invoke` call sites.
 *
 * A probe would have to be a command — there is no other way to reach the
 * Reader — so this is the complete list of what the app can ask the hardware to
 * do. Diagnostics is included because it sends commands like every other
 * surface; there is no privileged place a hidden check could live.
 */
function invokedCommands(): string[] {
  const commands = new Set<string>();
  const pattern = /invoke(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"/g;
  for (const text of Object.values(SOURCES)) {
    for (const match of text.matchAll(pattern)) commands.add(match[1] ?? "");
  }
  return [...commands];
}

/** A command or function name that would be asking the writability question. */
const PROBE_NAMES = /writab|probe|accepts?_?writes?|write_?check|can_?write|is_?writable/i;

/**
 * A SCREAMING_SNAKE name is copy, not a capability.
 *
 * `WILL_NOT_ACCEPT_WRITES` is the sentence a refusal says; it cannot ask the
 * hardware anything. Excluding these keeps the scan aimed at names that promise
 * an answer.
 */
const isCopyConstant = (name: string) => /^[A-Z][A-Z0-9_]*$/.test(name);

describe("the app's source, read rather than assumed", () => {
  it("is found, so an empty scan cannot pass as a clean one", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
    expect(Object.keys(SOURCES).some((file) => file.endsWith("/App.tsx"))).toBe(true);
    expect(Object.keys(SOURCES).some((file) => file.endsWith("/BlankTag.tsx"))).toBe(true);
  });
});

describe("the app's command surface", () => {
  const commands = invokedCommands();

  it("includes the Reset write itself", () => {
    expect(commands).toContain("lf_blank");
    expect(commands).toContain("lf_poll");
  });

  it("contains no writability probe, on any surface", () => {
    // A pre-check cannot be a settings toggle or a diagnostics button either: it
    // would still have to be a command, and it would still have to be a write.
    // Nor can it be hidden behind an acknowledgement, because the command would
    // still be there to find.
    expect(commands.filter((command) => PROBE_NAMES.test(command))).toEqual([]);
  });

  it("still offers the commands the documented capabilities need", () => {
    // The guard must not pass by the app having no commands at all.
    for (const command of ["lf_write", "lf_blank", "raw_send", "console_capability"]) {
      expect(commands, command).toContain(command);
    }
  });
});

describe("the app's functions", () => {
  it("expose nothing that answers whether a tag will accept a write", () => {
    // A function name is a promise. Anything shaped like `checkWritability`,
    // `probeTag` or `canWrite` would be that promise whether or not anything
    // calls it yet — which is how a probe gets added "just for diagnostics".
    const declared = /(?:export\s+)?(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_$]+)/g;
    const offending: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      for (const match of text.matchAll(declared)) {
        const name = match[1] ?? "";
        if (!isCopyConstant(name) && PROBE_NAMES.test(name)) offending.push(`${file}: ${name}`);
      }
    }
    expect(offending).toEqual([]);
  });
});

describe("what the app says instead", () => {
  it("states the limit in the capability limits, so the absence is documented", () => {
    const limit = READER_CAPABILITY_LIMITS.find((entry) => entry.id === "writability");
    expect(limit, "a writability limit entry").toBeTruthy();
    expect(`${limit?.label} ${limit?.detail}`).toMatch(/without attempting a write/i);
    expect(`${limit?.label} ${limit?.detail}`).toMatch(/no probe/i);
  });

  it("never claims a writability check as an available capability", () => {
    // A limit entry that says a check exists would be the invitation this ticket
    // removes, in the one place a user goes looking for the reason.
    for (const limit of READER_CAPABILITY_LIMITS) {
      const text = `${limit.label} ${limit.detail}`;
      expect(text).not.toMatch(/writability (check|test|probe) is (available|supported|possible)/i);
    }
  });
});
