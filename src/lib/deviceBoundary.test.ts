// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoFixtureBackend,
  DEVICE_FIXTURE_MARKER,
  FixtureBackendInReleaseError,
  fixtureBackendPresent,
  renderFatalNotice,
  type BoundaryTarget,
} from "./deviceBoundary";

/**
 * The runtime half of "a release build must never answer device calls from a
 * fixture".
 *
 * The structural half — the stub's modules are not in a release bundle — is a
 * fact about the build and is proved against the built output. This is the half
 * that still works if a future build configuration includes them anyway, so it
 * is the half that must be unbreakable: in a production build the app refuses to
 * render, says why, and throws. In a development build it does nothing at all,
 * because that is where the fixture belongs.
 */

/** The window with a fixture backend standing on it, as the stub would leave it. */
function withFixture(): BoundaryTarget {
  Object.defineProperty(window, DEVICE_FIXTURE_MARKER, {
    value: { beacon: "a verification fixture, not a Reader" },
    writable: true,
    configurable: true,
  });
  return window;
}

afterEach(() => {
  delete (window as { [DEVICE_FIXTURE_MARKER]?: unknown })[DEVICE_FIXTURE_MARKER];
  document.body.innerHTML = "";
});

describe("a production build", () => {
  it("refuses to render over a fixture backend", () => {
    withFixture();
    document.body.innerHTML = '<div id="root"></div>';

    expect(() => assertNoFixtureBackend({ production: true }, window)).toThrow(
      FixtureBackendInReleaseError,
    );
  });

  it("leaves the reason on screen, since a refusal nobody can read is a blank window", () => {
    withFixture();
    document.body.innerHTML = '<div id="root"></div>';

    expect(() => assertNoFixtureBackend({ production: true }, window)).toThrow();

    const notice = document.querySelector('[data-device-boundary="fixture-in-release-build"]');
    expect(notice?.textContent).toContain("This build will not run");
    expect(notice?.getAttribute("role")).toBe("alert");
  });

  it("renders normally when there is no fixture, which is every real release", () => {
    document.body.innerHTML = '<div id="root"></div>';

    expect(() => assertNoFixtureBackend({ production: true }, window)).not.toThrow();
    expect(document.querySelector("[data-device-boundary]")).toBeNull();
  });
});

describe("a development build", () => {
  it("does not object to the fixture it is supposed to have", () => {
    withFixture();
    document.body.innerHTML = '<div id="root"></div>';

    expect(() => assertNoFixtureBackend({ production: false }, window)).not.toThrow();
    expect(document.querySelector("[data-device-boundary]")).toBeNull();
  });
});

describe("the marker itself", () => {
  it("is the property the stub defines and this module looks for", () => {
    expect(fixtureBackendPresent({})).toBe(false);
    expect(fixtureBackendPresent(withFixture())).toBe(true);
  });
});

describe("the fatal notice", () => {
  it("is plain enough to stand in for a stylesheet that never loaded", () => {
    document.body.innerHTML = '<div id="root"></div>';
    renderFatalNotice(window, "a reason");

    const panel = document.querySelector<HTMLElement>("[data-device-boundary]");
    // No literal colours: the tokens are used where they exist, with system
    // colours behind them, so the notice is legible before the app's stylesheet
    // has been applied.
    expect(panel?.style.color).toContain("var(--color-text");
    expect(panel?.style.color).toContain("CanvasText");
  });
});
