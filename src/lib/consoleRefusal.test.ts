import { describe, expect, it } from "vitest";
import {
  BUILD_REFUSAL_LABEL,
  READ_ONLY_TITLE,
  buildRefusalFrom,
  capabilityFrom,
  permittedSentence,
} from "./consoleRefusal";
import type { ConsoleCapability } from "../types";

/**
 * The console's refusal and its read-only notice, read at the IPC boundary.
 *
 * A release build refuses a frame with a tagged value rather than a sentence, so
 * the console can show it as a limit of the build instead of as trouble with the
 * Tag in position. These are the three things that recognition rests on: the
 * tag, the command it names, and the reason.
 */

const REFUSAL = {
  kind: "refusedByBuild",
  cmd: "0x0073",
  message: "this build sends only commands that cannot change a tag, so 0x0073 was refused.",
};

describe("a build refusal read across the boundary", () => {
  it("recognises the refusal the backend sends", () => {
    expect(buildRefusalFrom(REFUSAL)).toEqual(REFUSAL);
  });

  it("keeps a device failure out of the refusal's place", () => {
    // A string rejection is what every other command reports, including a
    // write-guard refusal: about the Tag, not about this build.
    expect(buildRefusalFrom("could not read the tag on the reader")).toBeNull();
    expect(buildRefusalFrom(new Error("boom"))).toBeNull();
    expect(buildRefusalFrom(null)).toBeNull();
    expect(buildRefusalFrom(undefined)).toBeNull();
  });

  it("refuses a tagged value that is missing what the display names", () => {
    expect(buildRefusalFrom({ kind: "refusedByBuild" })).toBeNull();
    expect(buildRefusalFrom({ kind: "refusedByBuild", cmd: "0x0073" })).toBeNull();
    expect(buildRefusalFrom({ kind: "other", cmd: "0x0073", message: "x" })).toBeNull();
  });
});

describe("the capability read across the boundary", () => {
  it("carries the mode and the commands the backend permits", () => {
    const capability = {
      readOnly: true,
      commands: [{ cmd: "0x0081", name: "NTAG read" }],
    };
    expect(capabilityFrom(capability)).toEqual(capability);
  });

  it("is unknown rather than assumed when the answer is not one", () => {
    // A console that guessed would show a warning this build does not have, or
    // hide one it does.
    expect(capabilityFrom(null)).toBeNull();
    expect(capabilityFrom("read-only")).toBeNull();
    expect(capabilityFrom({ commands: [] })).toBeNull();
  });

  it("keeps the mode of a development build and lists nothing", () => {
    expect(capabilityFrom({ readOnly: false })).toEqual({ readOnly: false, commands: [] });
  });

  it("drops a command entry that is not one, rather than half-listing it", () => {
    const capability = capabilityFrom({
      readOnly: true,
      commands: [{ cmd: "0x0051", name: "wake / select" }, { cmd: "0x0081" }, "0x0083"],
    });
    expect(capability?.commands).toEqual([{ cmd: "0x0051", name: "wake / select" }]);
  });
});

describe("the console's own wording", () => {
  it("says read-only before anything is sent, not after a refusal", () => {
    expect(READ_ONLY_TITLE).toMatch(/read-only/i);
  });

  it("labels a refusal as the build's, not the Tag's", () => {
    expect(BUILD_REFUSAL_LABEL).toMatch(/build/i);
    expect(BUILD_REFUSAL_LABEL).not.toMatch(/tag/i);
  });

  it("lists the permitted commands by id and name", () => {
    const commands: ConsoleCapability["commands"] = [
      { cmd: "0x0051", name: "wake / select" },
      { cmd: "0x0081", name: "NTAG read" },
    ];
    expect(permittedSentence(commands)).toBe("0x0051 wake / select · 0x0081 NTAG read");
  });

  it("says so when the backend lists none", () => {
    expect(permittedSentence([])).toBe("No command is permitted.");
  });
});
