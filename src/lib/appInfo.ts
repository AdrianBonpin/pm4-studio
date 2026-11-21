/**
 * The facts about this build: its version, where its source lives, its licence,
 * and the protocol work it stands on.
 *
 * **The version has exactly one authoritative source: `package.json`.** That
 * field is imported here rather than restated, so About cannot drift from the
 * bundle. The two other manifests that carry a version —
 * `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` — are checked against
 * this value by `appInfo.test.ts`, which fails when either disagrees. Bumping a
 * release therefore means bumping all three, and the test says so rather than a
 * release note hoping so.
 *
 * The rest is here rather than inline in the page for the same reason the shell's
 * page copy lives in `lib/pageCopy.ts`: a URL, a licence and a credit are claims
 * about the project, and a claim that lives in JSX is a claim nothing checks.
 */

import { version } from "../../package.json";

/** The version this build reports, as `package.json` states it. */
export const APP_VERSION: string = version;

/** Where the source, the issues and the releases are. */
export const REPOSITORY_URL = "https://github.com/AdrianBonpin/pm4-studio";

/** The licence this project is released under, as `Cargo.toml` declares it. */
export const LICENCE = "MIT";

/** One project the protocol was reverse-engineered from. */
export interface Credit {
  readonly name: string;
  readonly url: string;
}

/**
 * The two projects whose captures and documentation made the protocol legible.
 * Named, with their addresses, rather than thanked in prose: a credit is a link.
 */
export const CREDITS: readonly Credit[] = [
  { name: "vicrodh/cyb-nfc", url: "https://github.com/vicrodh/cyb-nfc" },
  { name: "journeyman846/nfcx-tool", url: "https://github.com/journeyman846/nfcx-tool" },
];

/**
 * What the credits are for, in one sentence. It says the thing the old page
 * footer said on every page — without repeating on every page.
 */
export const CREDITS_NOTE =
  "The protocol was reverse-engineered from USB captures of this Reader. Not PC/SC, not CCID.";
