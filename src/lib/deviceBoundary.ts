/**
 * The one thing a shipped build must never do: answer a device call from a
 * fixture.
 *
 * The redesign's browser verification renders both band pages with no Reader
 * attached, which is only possible if something stands at the boundary the app
 * talks to the backend through — `window.__TAURI_INTERNALS__.invoke`. That
 * something is `src/dev/deviceStub.ts`, and it is a development tool. Shipping it
 * would be the worst outcome this design could produce: every page would look
 * like it was working on a tag that is not there, and the app's whole honesty
 * premise ("every claim is either measured from the reply or marked unavailable")
 * would be quietly inverted.
 *
 * The exclusion is therefore built twice, in two different places, because one
 * mechanism with one failure mode is what a build config change can undo:
 *
 *   1. **Structurally**, the stub is only reachable from `e2e.html`, a second
 *      entry point that `vite build` never reads. The production entry
 *      (`index.html` → `src/main.tsx`) does not import the stub, directly or
 *      transitively, so no release bundle can contain it and there is nothing to
 *      tree-shake away correctly.
 *   2. **At runtime**, from here. The stub marks the window when it installs, and
 *      this module refuses to let a production build render over that mark. It is
 *      in the shipped bundle on purpose: it is the half of the guarantee that
 *      still works if somebody one day adds the second entry to the production
 *      build, and it fails closed — a fatal screen and a thrown error, never a
 *      page that looks fine.
 *
 * The mark is a plain property name rather than a symbol or a WeakSet because the
 * stub and this module are separate module graphs in the browser (the stub is
 * loaded by the verification entry, this by the app), so the only thing they can
 * share is the window.
 */

/**
 * The property the verification stub defines on `window` when it installs.
 *
 * Absent in every shipped build. Present only on a window whose backend is a
 * fixture, which is exactly the condition this module exists to catch.
 */
export const DEVICE_FIXTURE_MARKER = "__PM4_DEVICE_FIXTURE_BACKEND__";

/** Which build is asking. Production refuses a fixture; development expects one. */
export interface BoundaryEnvironment {
  /** `import.meta.env.PROD` at the call site. */
  readonly production: boolean;
}

/** The window, as far as this module needs it. */
export interface BoundaryTarget {
  readonly [DEVICE_FIXTURE_MARKER]?: unknown;
  document?: Document;
}

/** Raised when a production build finds a fixture backend installed. */
export class FixtureBackendInReleaseError extends Error {
  constructor() {
    super(
      "A verification fixture is installed at the device boundary, and this is a " +
        "shipped build. Refusing to render: a release build must fail rather than " +
        "answer device calls from a fixture.",
    );
    this.name = "FixtureBackendInReleaseError";
  }
}

/** True when something has stood a fake backend on this window. */
export function fixtureBackendPresent(target: BoundaryTarget = window): boolean {
  return Boolean(target[DEVICE_FIXTURE_MARKER]);
}

/**
 * Refuse to run a shipped build over a fixture backend.
 *
 * Called once, from `src/main.tsx`, before anything renders. In a development
 * build it is deliberately a no-op — that is where the stub belongs — so the
 * check can never be the reason a developer's page looks broken.
 *
 * The failure is not silent in either channel that matters: it throws (so the
 * caller cannot swallow it into a blank page without noticing) and it leaves a
 * plain notice in the document, because the person running the build needs to
 * know what they are looking at rather than a white window.
 */
export function assertNoFixtureBackend(
  env: BoundaryEnvironment,
  target: BoundaryTarget = window,
): void {
  if (!env.production) return;
  if (!fixtureBackendPresent(target)) return;

  renderFatalNotice(target, new FixtureBackendInReleaseError().message);
  throw new FixtureBackendInReleaseError();
}

/**
 * Put the reason on screen for a build that refused to start.
 *
 * Deliberately not a component and not themed: it is the screen for the case
 * where the app must not run, it may be reached after the stylesheet failed, and
 * it is not part of the interface. Plain HTML, so it says the same thing whether
 * or not React mounted.
 */
export function renderFatalNotice(target: BoundaryTarget, reason: string): void {
  const document = target.document;
  const root = document?.getElementById("root");
  if (!document || !root) return;
  root.textContent = "";
  const panel = document.createElement("div");
  panel.setAttribute("role", "alert");
  panel.dataset.deviceBoundary = "fixture-in-release-build";
  // The app's tokens, because this notice is drawn where the app would have been
  // and should read as the same world refusing to start rather than as a
  // different program's error page.
  //
  // Every token carries a system-colour fallback, and the panel names the colour
  // scheme itself. This notice can be the first paint on a page whose stylesheet
  // has not been applied yet — it refused to start, remember — and a fatal
  // message nobody can read is not a failure, it is a blank window. `Canvas` and
  // `CanvasText` follow `color-scheme`, so the notice is legible either way and
  // still drawn from no literal colour.
  panel.style.cssText =
    "color-scheme:dark;max-width:40rem;margin:4rem auto;padding:1.5rem;" +
    "border:1px solid var(--color-err,CanvasText);border-radius:var(--radius-lg,0.75rem);" +
    "color:var(--color-text,CanvasText);background:var(--color-surface,Canvas);" +
    "font:14px/1.6 var(--font-family-sans,sans-serif)";
  const heading = document.createElement("p");
  heading.style.cssText = "margin:0 0 0.5rem;font-weight:600";
  heading.textContent = "This build will not run.";
  const body = document.createElement("p");
  body.style.cssText = "margin:0;color:var(--color-text-muted,CanvasText)";
  body.textContent = reason;
  panel.append(heading, body);
  root.append(panel);
}
