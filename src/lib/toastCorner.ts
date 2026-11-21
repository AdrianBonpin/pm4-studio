/**
 * Which corner the messages appear in.
 *
 * A stored setting the user owns (the control for it arrives with the Settings
 * page), so it lives in `localStorage` beside the beep preference rather than in
 * component state: choosing a corner and restarting the app must not put the
 * messages back where they were. Bottom-right is the default because the working
 * area of both band pages is the top and the middle.
 *
 * The four positions are the whole vocabulary — a free-form offset would let a
 * message sit over the control the user is reaching for.
 */

/** The four corners, default first. */
export const TOAST_CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;

export type ToastCorner = (typeof TOAST_CORNERS)[number];

/**
 * The words for each corner, for the control that chooses one.
 *
 * A corner is a place on the screen, so it is named as one: `bottom-right` is a
 * storage value, and it is not what the user is shown. The words mirror the
 * geometry — top row first — so the control can be laid out in the shape of the
 * window.
 */
export const TOAST_CORNER_LABEL: Record<ToastCorner, string> = {
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
  "top-right": "Top right",
  "top-left": "Top left",
};

/** The same default the spec states, named so tests do not hard-code it twice. */
export const DEFAULT_TOAST_CORNER: ToastCorner = "bottom-right";

/** The persisted key. A new key would need a migration; this one is new. */
export const TOAST_CORNER_KEY = "pm4studio.toastCorner";

/** The slice of `Storage` this module needs, so a test can hand in its own. */
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storageOrDefault(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

/** Whether a stored value is one of the four positions. */
export function isToastCorner(value: unknown): value is ToastCorner {
  return typeof value === "string" && (TOAST_CORNERS as readonly string[]).includes(value);
}

/**
 * The stored corner, or the default.
 *
 * A value the app cannot read is treated as no choice at all rather than coerced
 * into a position it does not know: the alternative is a message in a corner
 * nobody asked for.
 */
export function loadToastCorner(storage?: Storage | null): ToastCorner {
  const source = storageOrDefault(storage);
  if (!source) return DEFAULT_TOAST_CORNER;
  try {
    const stored = source.getItem(TOAST_CORNER_KEY);
    return isToastCorner(stored) ? stored : DEFAULT_TOAST_CORNER;
  } catch {
    return DEFAULT_TOAST_CORNER;
  }
}

/** Remember the corner. A storage that refuses is not worth failing over. */
export function saveToastCorner(corner: ToastCorner, storage?: Storage | null): void {
  const target = storageOrDefault(storage);
  if (!target) return;
  try {
    target.setItem(TOAST_CORNER_KEY, corner);
  } catch {
    // A full or disabled storage loses the preference, not the message.
  }
  notifyToastCorner();
}

/** Placement classes for one corner: fixed to the window, inside the frame. */
export function toastCornerClasses(corner: ToastCorner): string {
  switch (corner) {
    case "bottom-right":
      return "bottom-4 right-4 flex-col-reverse";
    case "bottom-left":
      return "bottom-4 left-4 flex-col-reverse";
    case "top-right":
      return "top-4 right-4 flex-col";
    case "top-left":
      return "top-4 left-4 flex-col";
  }
}

const listeners = new Set<() => void>();

/** Listen for a changed corner, so a rendered corner follows the setting. */
export function subscribeToastCorner(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyToastCorner(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Forget the stored corner, falling back to the default.
 *
 * This is the clear-all action's half: it removes the key rather than writing the
 * default over it, because the point is that no choice is stored. The change is
 * announced, so a rendered corner moves back without a restart.
 */
export function resetToastCorner(): void {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(TOAST_CORNER_KEY);
    } catch {
      // A storage that refuses to forget leaves the corner where it was; the
      // clear action's report says the key survived.
    }
  }
  notifyToastCorner();
}
