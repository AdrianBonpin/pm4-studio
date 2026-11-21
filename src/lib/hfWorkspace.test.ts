import { describe, expect, it } from "vitest";
import { HF_MODES, HF_MODE_LABEL, HF_MODE_ORDER } from "./hfWorkspace";

/**
 * Ticket 14 — the 13.56 MHz workspace's mode contract.
 *
 * These are the facts the page's switch and its panels are built from, asserted
 * where they are defined rather than through a render: the work order, the four
 * modes this build offers, and the slot Copy already holds so ticket 15 adds a
 * mode without relaying the page out.
 */

describe("the 13.56 MHz mode contract", () => {
  it("is the work order, not history and not the alphabet", () => {
    expect(HF_MODE_ORDER).toEqual(["read", "write", "copy", "erase", "memory"]);
  });

  it("gives Copy its slot between Write and Erase, ahead of its panel", () => {
    // Copy's panel arrives in ticket 15; the place it will appear is decided now.
    expect(HF_MODE_ORDER.indexOf("copy")).toBe(HF_MODE_ORDER.indexOf("write") + 1);
    expect(HF_MODE_ORDER.indexOf("erase")).toBe(HF_MODE_ORDER.indexOf("copy") + 1);
    expect(HF_MODES.map((mode) => mode.id)).not.toContain("copy");
  });

  it("shows Read, Write, Erase and Memory today, in that order", () => {
    expect(HF_MODES.map((mode) => mode.id)).toEqual(["read", "write", "erase", "memory"]);
    expect(HF_MODES.map((mode) => mode.label)).toEqual(["Read", "Write", "Erase", "Memory"]);
  });

  it("names the memory-dump mode Memory, never Diagnostics", () => {
    // Diagnostics is Settings' group, which owns the capability limits. Two
    // destinations with one name is the defect this naming settles.
    expect(HF_MODE_LABEL.memory).toBe("Memory");
    expect(Object.values(HF_MODE_LABEL)).not.toContain("Diagnostics");
  });
});
