import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import cargoToml from "../../src-tauri/Cargo.toml?raw";
import { APP_VERSION, CREDITS, LICENCE, REPOSITORY_URL } from "./appInfo";

/**
 * The version has **one** authoritative source, and this file is the mechanism
 * that keeps it that way.
 *
 * Three manifests carry a version today — `package.json`, `src-tauri/tauri.conf.json`
 * and `src-tauri/Cargo.toml` — and they happen to agree at 0.2.0. "They agree" is
 * not a mechanism and would not survive the next release: a bump applied to two
 * of the three ships an app whose About page, bundle and crate disagree.
 *
 * So `package.json` is the source: it is the manifest a JavaScript release tool
 * bumps, and `lib/appInfo.ts` imports its `version` field rather than restating
 * it. The two other manifests are checked against it here, and `src-tauri/` is
 * read as text because it cannot be imported as a module.
 *
 * A failure here means: bump the manifest named in the message, not this test.
 */

/** The `version` in Cargo.toml's `[package]` block, or `null` when there is none. */
function cargoPackageVersion(toml: string): string | null {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "[package]");
  if (start === -1) return null;
  for (const line of lines.slice(start + 1)) {
    // The next table ends the block: a `version` under `[dependencies]` is
    // another crate's pin, not this one's.
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*version\s*=\s*"([^"]+)"/.exec(line);
    if (match) return match[1] ?? null;
  }
  return null;
}

describe("the app's version", () => {
  it("comes from package.json, and the app reads that field rather than a copy", () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("is the version the Tauri bundle is stamped with", () => {
    // Fails when tauri.conf.json disagrees with package.json.
    expect(tauriConfig.version).toBe(APP_VERSION);
  });

  it("is the version the Rust crate is stamped with", () => {
    // Fails when Cargo.toml disagrees with package.json.
    expect(cargoPackageVersion(cargoToml)).toBe(APP_VERSION);
  });
});

describe("the facts About states", () => {
  it("names one repository, at the address the crate points at", () => {
    expect(REPOSITORY_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    // Cargo.toml's `repository` is the same project; a second address would make
    // the About link and the crate disagree about which repo this is.
    expect(cargoToml).toContain(`repository = "${REPOSITORY_URL}"`);
  });

  it("names the licence the crate declares", () => {
    expect(LICENCE).toBe("MIT");
    expect(cargoToml).toMatch(/^license\s*=\s*"MIT"$/m);
  });

  it("credits the two protocol reverse-engineering projects", () => {
    expect(CREDITS.map((credit) => credit.url)).toEqual([
      "https://github.com/vicrodh/cyb-nfc",
      "https://github.com/journeyman846/nfcx-tool",
    ]);
  });
});
