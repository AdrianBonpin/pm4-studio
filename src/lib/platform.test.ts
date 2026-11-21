import { afterEach, describe, expect, it, vi } from "vitest";
import { isMacOS, isTauri } from "./platform";
import { INPUT_ROUNDING } from "./uiConstants";

// Establishes the unit test runner. Every seam added later gets its own file
// beside it; this one only proves the runner resolves src/ and can drive the
// browser globals these helpers read.
describe("platform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports no Tauri internals in a bare environment", () => {
    expect(isTauri()).toBe(false);
  });

  it("detects macOS from the platform string", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "test" });
    expect(isMacOS()).toBe(true);
  });

  it("falls back to the user agent when platform is empty", () => {
    vi.stubGlobal("navigator", { platform: "", userAgent: "Mozilla/5.0 Macintosh" });
    expect(isMacOS()).toBe(true);
  });

  it("rejects non-Apple platforms", () => {
    vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Mozilla/5.0 Windows NT" });
    expect(isMacOS()).toBe(false);
  });

  it("keeps form controls on one shared radius", () => {
    expect(INPUT_ROUNDING).toBe("rounded-lg");
  });
});
