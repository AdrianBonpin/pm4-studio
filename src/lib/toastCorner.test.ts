import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOAST_CORNER,
  TOAST_CORNER_KEY,
  TOAST_CORNERS,
  isToastCorner,
  loadToastCorner,
  saveToastCorner,
  toastCornerClasses,
} from "./toastCorner";

/**
 * Where messages appear: four corners, one stored choice, bottom-right by
 * default.
 *
 * The storage is handed in rather than reached for, so what is stored, and what
 * is done with a stored value the app can no longer read, are both stated here
 * instead of being implied by a browser.
 */

/** A stand-in for the webview's localStorage, holding one key. */
function storage(initial?: string | null) {
  const values = new Map<string, string>();
  if (initial !== undefined && initial !== null) values.set(TOAST_CORNER_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    read: () => values.get(TOAST_CORNER_KEY) ?? null,
  };
}

describe("the corner preference", () => {
  it("is bottom-right until the user says otherwise", () => {
    expect(DEFAULT_TOAST_CORNER).toBe("bottom-right");
    expect(loadToastCorner(storage())).toBe("bottom-right");
  });

  it("offers exactly four corners", () => {
    expect([...TOAST_CORNERS].sort()).toEqual(
      ["bottom-left", "bottom-right", "top-left", "top-right"].sort(),
    );
  });

  it("survives a restart, because it is written to storage", () => {
    const store = storage();
    saveToastCorner("top-left", store);

    expect(store.read()).toBe("top-left");
    // A fresh read is what a restart does.
    expect(loadToastCorner(store)).toBe("top-left");
  });

  it("falls back to the default rather than trusting what it finds", () => {
    expect(loadToastCorner(storage("middle"))).toBe("bottom-right");
    expect(loadToastCorner(storage(""))).toBe("bottom-right");
    expect(loadToastCorner(null)).toBe("bottom-right");
    expect(isToastCorner("mirror")).toBe(false);
    expect(isToastCorner("top-right")).toBe(true);
  });

  it("places the messages in the corner it was asked for", () => {
    expect(toastCornerClasses("bottom-right")).toContain("bottom-4");
    expect(toastCornerClasses("bottom-right")).toContain("right-4");
    expect(toastCornerClasses("bottom-left")).toContain("left-4");
    expect(toastCornerClasses("top-right")).toContain("top-4");
    expect(toastCornerClasses("top-left")).toContain("left-4");
    expect(toastCornerClasses("top-left")).toContain("top-4");
  });
});
