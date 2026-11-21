// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { BlankTag } from "./BlankTag";
import { fakeBackend, renderUi } from "../test/dom";
import { blankConfirmation } from "../lib/blankTag";
import { subscribeSignals, type SignalSymbol } from "../lib/signal";
import { toastStore } from "../lib/toastStore";
import type { BlankResult, LfCard } from "../types";

/**
 * Gate 5 of 8: blanking a Tag's Identity.
 *
 * Blanking destroys the Identity the Tag carries, so the flow reads the Tag
 * first and then asks: the confirmation names that Identity and is passed back
 * into the write, so the Rust guard can refuse a Tag that is not the one the
 * user consented to. `lf_blank` is the confirmation's button.
 */

const CARD: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "55 00 84 82 12",
};

const BLANKED: BlankResult = {
  customer: CARD.customer,
  data32: CARD.data32,
  outcome: "blanked",
  blanked: true,
  stillIdentifies: null,
  message: null,
};

/** The re-read still found an Identity: this tag will not accept writes. */
const WILL_NOT_ACCEPT: BlankResult = {
  customer: CARD.customer,
  data32: CARD.data32,
  outcome: "willNotAcceptWrites",
  blanked: false,
  stillIdentifies: CARD.id,
  message: `the tag still reads as ${CARD.id} after the blanking write`,
};

beforeEach(() => {
  toastStore.clear();
});

/** Everything the audible half was told, for one assertion. */
function hearSignals(): { symbols: SignalSymbol[]; stop: () => void } {
  const symbols: SignalSymbol[] = [];
  const stop = subscribeSignals((symbol) => symbols.push(symbol));
  return { symbols, stop };
}

/** The heading the confirmation gives the Identity it is about to destroy. */
const TITLE = blankConfirmation(CARD.id).title;

/** Read the Tag and stop with its confirmation on screen. */
async function upToConfirmation(reply: BlankResult = BLANKED) {
  const backend = fakeBackend({
    lf_poll: () => CARD,
    lf_blank: () => reply,
  });
  const { user } = renderUi(
    <BlankTag connected onChirp={() => {}} onDeviceError={() => {}} />,
  );

  await user.click(screen.getByRole("button", { name: "Read the tag to blank" }));
  await screen.findByText(TITLE);

  return { backend, user };
}

describe("blanking a Tag", () => {
  it("asks first, and keeping the tag as it is blanks nothing", async () => {
    const { backend, user } = await upToConfirmation();

    await user.click(screen.getByRole("button", { name: "Keep the tag as it is" }));

    expect(backend.callsTo("lf_blank")).toHaveLength(0);
    expect(screen.queryByText(TITLE)).toBeNull();
    // The flow is back at its start, with nothing destroyed.
    expect(screen.getByRole("button", { name: "Read the tag to blank" })).toBeTruthy();
  });

  it("blanks the Identity that was read when confirmed", async () => {
    const { backend, user } = await upToConfirmation();

    await user.click(screen.getByRole("button", { name: "Blank this tag permanently" }));

    await waitFor(() => {
      expect(backend.callsTo("lf_blank")).toHaveLength(1);
    });
    // The Identity the confirmation named, sent as the guard's argument.
    expect(backend.callsTo("lf_blank")[0]?.args).toEqual({
      customer: CARD.customer,
      data32: CARD.data32,
    });
  });
});

describe("the confirmation tells the truth before the write", () => {
  it("states the three writability caveats on screen, as facts not a footnote", async () => {
    await upToConfirmation();

    // Asserted by what is rendered, not by what the module exports: the caveats
    // are on the screen the button is on.
    expect(screen.getByText(/cannot tell whether a tag will accept a write/i)).toBeTruthy();
    expect(screen.getByText(/may permanently refuse every later write/i)).toBeTruthy();
    expect(screen.getByText(/afford to lose/i)).toBeTruthy();
  });

  it("never offers, or hints at, a way to check the tag first", async () => {
    // There is no probe, so nothing may invite one (ADR 0007). The screen holds
    // exactly the write and the way out of it.
    await upToConfirmation();

    expect(screen.getByRole("button", { name: "Blank this tag permanently" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep the tag as it is" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/check the tag|check first|probe/i);
  });
});

describe("a tag that will not accept writes", () => {
  it("is reported as such, not as a generic failure or an unknown", async () => {
    const { user } = await upToConfirmation(WILL_NOT_ACCEPT);

    await user.click(screen.getByRole("button", { name: "Blank this tag permanently" }));

    const [toast] = await waitFor(() => {
      expect(toastStore.getState().toasts.length).toBe(1);
      return toastStore.getState().toasts;
    });
    expect(toast?.message).toContain("This tag will not accept writes.");
    expect(toast?.message).toMatch(/already been written/i);
    expect(toast?.message).toMatch(/never writable/i);
    expect(toast?.severity).toBe("error");
  });

  it("sounds the attention symbol through the seam rather than chirping itself", async () => {
    const { symbols, stop } = hearSignals();
    const { user } = await upToConfirmation(WILL_NOT_ACCEPT);

    await user.click(screen.getByRole("button", { name: "Blank this tag permanently" }));

    await waitFor(() => {
      expect(symbols).toEqual(["attention"]);
    });
    stop();
  });

  it("shows what the tag still reads, and never claims a copy or a blank", async () => {
    const { user } = await upToConfirmation(WILL_NOT_ACCEPT);

    await user.click(screen.getByRole("button", { name: "Blank this tag permanently" }));

    await screen.findByText(/will not accept writes/i);
    expect(screen.getByText(/Still on the tag/)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("This tag will not accept writes.");
    expect(text).toContain(CARD.id);
    expect(text).not.toMatch(/Blanked —/);
    expect(text).not.toMatch(/confirmed cop(y|ies)/i);
    expect(text).not.toMatch(/verified/i);
  });
});

describe("a never-written tag", () => {
  it("still resets, and the success is reported as blanked rather than verified", async () => {
    const { symbols, stop } = hearSignals();
    const { backend, user } = await upToConfirmation(BLANKED);

    await user.click(screen.getByRole("button", { name: "Blank this tag permanently" }));

    expect(backend.callsTo("lf_blank")).toHaveLength(1);
    const [toast] = await waitFor(() => {
      expect(toastStore.getState().toasts.length).toBe(1);
      return toastStore.getState().toasts;
    });
    expect(toast?.message).toContain("Blanked");
    expect(toast?.message).not.toMatch(/verified/i);
    expect(toast?.severity).toBe("success");
    expect(symbols).toEqual(["done"]);
    stop();
  });
});
