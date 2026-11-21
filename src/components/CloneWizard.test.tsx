// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { CloneWizard } from "./CloneWizard";
import { fakeBackend, renderUi } from "../test/dom";
import { replacementConfirmation } from "../lib/replacement";
import type { LfCard, WriteResult } from "../types";

/**
 * Gate 3 of 8: cloning an Identity onto the Tag in the write position.
 *
 * The clone flow reads the original, reads the destination, and then asks: the
 * confirmation names the Identity the destination carries now, because the guard
 * permits writing over a Tag carrying a *different* Identity. The write is the
 * confirmation's button, not the "Use this tag" control and not the reading that
 * preceded it.
 *
 * Both tests stop at the same place — a destination read, a confirmation on
 * screen — and then take the two exits. The dismissing test's assertion is what
 * fails if the confirmation is dropped and the second read writes immediately.
 */

/** The original, read first. */
const SOURCE: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "55 00 84 82 12",
};

/** The Tag in the write position: it carries another Identity, so this write destroys it. */
const DEST: LfCard = {
  customer: 0x77,
  data32: 0x00ab_cdef,
  id: "77 00 AB CD EF",
  facility: 0xab,
  card: 0xcdef,
  raw: "77 00 AB CD EF",
};

const WRITTEN: WriteResult = {
  customer: SOURCE.customer,
  data32: SOURCE.data32,
  readback: { ...SOURCE, id: SOURCE.id },
  outcome: "verified",
  verified: true,
  message: null,
  refusalCause: null,
  confirmedCopies: null,
  countProblem: null,
};

/** The words on the button that sends this write, from the shared confirmation. */
const ACTION = replacementConfirmation(SOURCE, { kind: "identified", card: DEST }).action;

/**
 * Read the original, then read the destination, and stop with the confirmation
 * on screen. The two reads are the poller's replies, scripted in the order the
 * flow asks for them.
 */
async function upToConfirmation() {
  const reads: (LfCard | null)[] = [SOURCE, DEST, DEST];
  const backend = fakeBackend({
    lf_poll: () => reads.shift() ?? DEST,
    lf_write: () => WRITTEN,
  });
  const { user, container } = renderUi(
    <CloneWizard connected onChirp={() => {}} onDeviceError={() => {}} />,
  );

  await user.click(screen.getByRole("button", { name: "Start clone" }));
  // The first read is the original: it becomes the Identity being written.
  await user.click(await screen.findByRole("button", { name: "Use this tag" }));
  // The second read is the destination, which is what the confirmation names.
  await screen.findByRole("button", { name: ACTION });

  return { backend, user, container };
}

describe("cloning onto the Tag on the reader", () => {
  it("asks, naming the Identity it replaces, and cancelling writes nothing", async () => {
    const { backend, user, container } = await upToConfirmation();

    // The confirmation names what would be destroyed, from the read that saw it.
    expect(screen.getByText(`Writing ${SOURCE.id} replaces ${DEST.id}`)).toBeTruthy();
    // And it is rendered by the shared component, in its destructive tone. The
    // clone path once carried its own copy with the milder frame for exactly this
    // case, so the alarm is asserted here rather than left to the other path.
    expect(container.querySelector(".bg-warn\\/5")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(backend.callsTo("lf_write")).toHaveLength(0);
    // And the confirmation is gone: the flow is back at its start.
    expect(screen.queryByRole("button", { name: ACTION })).toBeNull();
    expect(screen.getByRole("button", { name: "Start clone" })).toBeTruthy();
  });

  it("writes the Identity that was read from the original when confirmed", async () => {
    const { backend, user } = await upToConfirmation();

    await user.click(screen.getByRole("button", { name: ACTION }));

    await waitFor(() => {
      expect(backend.callsTo("lf_write")).toHaveLength(1);
    });
    // The Identity from the source read, sent as the guarded `lf_write` payload.
    expect(backend.callsTo("lf_write")[0]?.args).toEqual({
      customer: SOURCE.customer,
      data32: SOURCE.data32,
    });
  });
});
