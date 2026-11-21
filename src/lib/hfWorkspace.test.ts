import { describe, expect, it } from "vitest";
import { HF_MODES, HF_MODE_LABEL, HF_MODE_ORDER } from "./hfWorkspace";

/**
 * Ticket 14 — the 13.56 MHz workspace's mode contract.
 *
 * These are the facts the page's switch and its panels are built from, asserted
 * where they are defined rather than through a render: the work order, and the
 * five modes this build offers, Copy included in the slot the order gave it.
 */

describe("the 13.56 MHz mode contract", () => {
  it("is the work order, not history and not the alphabet", () => {
    expect(HF_MODE_ORDER).toEqual(["read", "write", "copy", "erase", "memory"]);
  });

  it("gives Copy the slot between Write and Erase, and shows it there", () => {
    expect(HF_MODE_ORDER.indexOf("copy")).toBe(HF_MODE_ORDER.indexOf("write") + 1);
    expect(HF_MODE_ORDER.indexOf("erase")).toBe(HF_MODE_ORDER.indexOf("copy") + 1);
    expect(HF_MODES.map((mode) => mode.id)).toContain("copy");
  });

  it("shows Read, Write, Copy, Erase and Memory, in that order", () => {
    expect(HF_MODES.map((mode) => mode.id)).toEqual(["read", "write", "copy", "erase", "memory"]);
    expect(HF_MODES.map((mode) => mode.label)).toEqual([
      "Read",
      "Write",
      "Copy",
      "Erase",
      "Memory",
    ]);
  });

  it("names the memory-dump mode Memory, never Diagnostics", () => {
    // Diagnostics is Settings' group, which owns the capability limits. Two
    // destinations with one name is the defect this naming settles.
    expect(HF_MODE_LABEL.memory).toBe("Memory");
    expect(Object.values(HF_MODE_LABEL)).not.toContain("Diagnostics");
  });
});
