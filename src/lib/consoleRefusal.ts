/**
 * The raw console's two pieces of news, and how the webview tells them apart.
 *
 * A release build sends only commands that cannot change a Tag (ADR 0006). When
 * it refuses one it answers with a tagged value, not a sentence, so the console
 * can show the refusal as a limit of the build. Every other failure — a
 * malformed frame, an absent Reader, a write-guard refusal from another surface
 * — arrives as plain text, because it is about the frame or the Tag in position
 * and not about which binary is running.
 *
 * The console states its mode before it is used rather than letting the user
 * discover it by being refused: `READ_ONLY_TITLE` and `READ_ONLY_BODY` are that
 * statement, and the permitted commands come from the backend so the two cannot
 * disagree.
 */

import type { BuildRefusal, ConsoleCapability, ConsoleCommand } from "../types";

/** The console's headline when this build sends only read commands. */
export const READ_ONLY_TITLE = "Read-only in this build";

/** Why it is read-only, and where the write experiments went. */
export const READ_ONLY_BODY =
  "This console sends only commands that cannot change a tag. Write experiments run in a " +
  "development build: start one with `cargo run` from the repository rather than opening " +
  "the installed app.";

/** The label over a frame this build refused, which is not a Tag's refusal. */
export const BUILD_REFUSAL_LABEL = "Refused by this build";

/** The sentence that keeps a console refusal apart from a write-guard refusal. */
export const BUILD_REFUSAL_DETAIL =
  "This is about the build, not the tag on the reader. A guard refusal names the tag and " +
  "says what is wrong with it; this one never looked at a tag.";

/** "0x0051 wake / select · 0x0083 NTAG info" — what a release build does send. */
export function permittedSentence(commands: ConsoleCommand[]): string {
  if (commands.length === 0) return "No command is permitted.";
  return commands.map((command) => `${command.cmd} ${command.name}`).join(" · ");
}

/** A capability the console can render, or `null` when it is not one. */
export function capabilityFrom(value: unknown): ConsoleCapability | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<ConsoleCapability>;
  if (typeof candidate.readOnly !== "boolean") return null;
  const commands = Array.isArray(candidate.commands) ? candidate.commands : [];
  return {
    readOnly: candidate.readOnly,
    commands: commands.filter(
      (command): command is ConsoleCommand =>
        typeof command === "object" &&
        command !== null &&
        typeof (command as Partial<ConsoleCommand>).cmd === "string" &&
        typeof (command as Partial<ConsoleCommand>).name === "string",
    ),
  };
}

/**
 * The build refusal an error carries, or `null` when it is anything else.
 *
 * A rejection can be a string, an `Error`, `undefined`, or a value from the
 * backend; only a value that names a refused command and says why is shown as a
 * build refusal, so nothing is guessed from the prose of a message.
 */
export function buildRefusalFrom(error: unknown): BuildRefusal | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Partial<BuildRefusal>;
  if (candidate.kind !== "refusedByBuild") return null;
  if (typeof candidate.cmd !== "string" || typeof candidate.message !== "string") return null;
  return { kind: "refusedByBuild", cmd: candidate.cmd, message: candidate.message };
}
