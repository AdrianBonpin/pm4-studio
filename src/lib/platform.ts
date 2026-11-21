/** True only on macOS — the "Overlay" title bar drag strip is gated on this.
 *  Matches gridline's helper so both apps behave identically. */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = (navigator.platform || "").toLowerCase();
  const u = (navigator.userAgent || "").toLowerCase();
  return p.includes("mac") || u.includes("macintosh") || u.includes("mac os");
}

/** True only inside the Tauri webview (not during browser-based tests). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
