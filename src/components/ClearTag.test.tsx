// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { ClearTag } from "./ClearTag";
import { fakeBackend, renderUi } from "../test/dom";
import {
  CLEAR_ACTION_LABEL,
  CLEAR_READ_CONTROL,
  DESTROY_ACTION_LABEL,
  DESTROY_ENTER_CONTROL,
  clearConfirmation,
  destroyConfirmation,
} from "../lib/clearTag";
import { subscribeSignals, type SignalSymbol } from "../lib/signal";
import { toastStore } from "../lib/toastStore";
import type { ClearResult, LfCard } from "../types";

/**
 * Gate 5 of 8: clearing a Tag's Identity, and destroying one.
 *
 * Both overwrite the Identity the Tag carries, so both flows read the Tag first
 * and then ask: the confirmation names that Identity and is passed back into the
 * write, so the Rust guard can refuse a Tag that is not the one the user
 * consented to. `lf_clear` is the confirmation's button, for either operation.
 */

const CARD: LfCard = {
  customer: 0x55,
  data32: 0x0084_8212,
  id: "55 00 84 82 12",
  facility: 0x84,
  card: 0x8212,
  raw: "55 00 84 82 12",
};

/** The placeholder the backend reports after a Clear that landed. */
const PLACEHOLDER = "00 00 FF FF FF";

const CLEARED: ClearResult = {
  customer: CARD.customer,
  data32: CARD.data32,
  operation: "clear",
  outcome: "cleared",
  cleared: true,
  destroyed: false,
  presents: PLACEHOLDER,
  message: null,
};

const DESTROYED: ClearResult = {
  customer: CARD.customer,
  data32: CARD.data32,
  operation: "destroy",
  outcome: "destroyed",
  cleared: false,
  destroyed: true,
  presents: null,
  message: null,
};

/** The re-read did not show what was written: this tag will not accept writes. */
const WILL_NOT_ACCEPT: ClearResult = {
  customer: CARD.customer,
  data32: CARD.data32,
  operation: "clear",
  outcome: "willNotAcceptWrites",
  cleared: false,
  destroyed: false,
  presents: CARD.id,
  message: `the tag still reads as ${CARD.id} after the clearing write`,
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

const CLEAR_TITLE = clearConfirmation(CARD.id).title;
const DESTROY_TITLE = destroyConfirmation(CARD.id).title;

/** Read the Tag and stop with Clear's confirmation on screen. */
async function upToClear(reply: ClearResult = CLEARED) {
  const backend = fakeBackend({
    lf_poll: () => CARD,
    lf_clear: () => reply,
  });
  const { user } = renderUi(<ClearTag connected onDeviceError={() => {}} />);

  await user.click(screen.getByRole("button", { name: CLEAR_READ_CONTROL }));
  await screen.findByText(CLEAR_TITLE);

  return { backend, user };
}

/** Read the Tag and stop with Destroy's confirmation on screen. */
async function upToDestroy(reply: ClearResult = DESTROYED) {
  const backend = fakeBackend({
    lf_poll: () => CARD,
    lf_clear: () => reply,
  });
  const { user } = renderUi(<ClearTag connected onDeviceError={() => {}} />);

  await user.click(screen.getByRole("button", { name: DESTROY_ENTER_CONTROL }));
  await screen.findByText(DESTROY_TITLE);

  return { backend, user };
}

describe("clearing a Tag", () => {
  it("asks first, and keeping the tag as it is writes nothing", async () => {
    const { backend, user } = await upToClear();

    await user.click(screen.getByRole("button", { name: "Keep the tag as it is" }));

    expect(backend.callsTo("lf_clear")).toHaveLength(0);
    expect(screen.queryByText(CLEAR_TITLE)).toBeNull();
    // The flow is back at its start, with nothing overwritten.
    expect(screen.getByRole("button", { name: CLEAR_READ_CONTROL })).toBeTruthy();
  });

  it("clears the Identity that was read when confirmed, as a clear", async () => {
    const { backend, user } = await upToClear();

    await user.click(screen.getByRole("button", { name: CLEAR_ACTION_LABEL }));

    await waitFor(() => {
      expect(backend.callsTo("lf_clear")).toHaveLength(1);
    });
    // The Identity the confirmation named, and the operation the user chose.
    expect(backend.callsTo("lf_clear")[0]?.args).toEqual({
      customer: CARD.customer,
      data32: CARD.data32,
      operation: "clear",
    });
  });

  it("reports a clear as cleared, in one chirp, and shows the placeholder", async () => {
    const { symbols, stop } = hearSignals();
    const { backend, user } = await upToClear();

    await user.click(screen.getByRole("button", { name: CLEAR_ACTION_LABEL }));

    expect(backend.callsTo("lf_clear")).toHaveLength(1);
    const [toast] = await waitFor(() => {
      // The read, then the write: two operations, two outcomes.
      expect(toastStore.getState().toasts.length).toBe(2);
      return toastStore.getState().toasts;
    });
    expect(toast?.message).toContain("Cleared —");
    expect(toast?.message).toContain(PLACEHOLDER);
    expect(toast?.message).toMatch(/written again from this app/i);
    expect(toast?.message).not.toMatch(/destroyed/i);
    expect(toast?.message).not.toMatch(/verified/i);
    expect(toast?.severity).toBe("success");
    expect(symbols).toEqual(["done", "done"]);

    expect(await screen.findByText(PLACEHOLDER)).toBeTruthy();
    stop();
  });
});

describe("a cleared tag can be rewritten from this app", () => {
  // The user's requirement, named for it: after a Clear the tag must be able to be
  // cleared again — and written with a real Identity — from inside the app, with no
  // read-before-write refusal. The write guard's half is proved in Rust
  // (`write_guard::a_cleared_tag_is_a_legal_write_position_for_a_new_identity`);
  // this is the interface's half: the flow runs again on the tag it just cleared,
  // without a refusal and without a second gate.
  it("runs the everyday action again on the tag it just cleared", async () => {
    const { backend, user } = await upToClear();

    await user.click(screen.getByRole("button", { name: CLEAR_ACTION_LABEL }));
    await screen.findByText(PLACEHOLDER);

    // The repeat control returns to the first screen — the safe default — and the
    // same flow runs again on the cleared tag.
    await user.click(screen.getByRole("button", { name: /Clear another tag/ }));
    await user.click(screen.getByRole("button", { name: CLEAR_READ_CONTROL }));
    await screen.findByText(CLEAR_TITLE);
    await user.click(screen.getByRole("button", { name: CLEAR_ACTION_LABEL }));

    await waitFor(() => {
      expect(backend.callsTo("lf_clear")).toHaveLength(2);
    });
    for (const call of backend.callsTo("lf_clear")) {
      expect(call.args).toEqual({
        customer: CARD.customer,
        data32: CARD.data32,
        operation: "clear",
      });
    }
  });

  it("is offered as a place to write a real Identity, not as a dead tag", async () => {
    const { user } = await upToClear();

    await user.click(screen.getByRole("button", { name: CLEAR_ACTION_LABEL }));

    // The result says the tag is a fair place for a real Identity, in Clear's own
    // words — and never that the tag is disabled or unrecoverable.
    const text = await screen.findByText(/fair\s+place to write a real Identity/i);
    expect(text.textContent).toMatch(/not a working credential/i);
    expect(document.body.textContent ?? "").not.toMatch(/cannot be reused/i);
  });
});

describe("destroying a Tag", () => {
  it("is a separate entry point, not a second button on Clear's confirmation", async () => {
    // The everyday action never leads here. Clear's confirmation holds exactly the
    // write and the way out of it, so repeating the action cannot reach Destroy.
    await upToClear();

    const buttons = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(buttons.some((label) => label.includes(DESTROY_ACTION_LABEL))).toBe(false);
    expect(buttons.some((label) => label.includes("Destroy"))).toBe(false);
    expect(buttons).toHaveLength(2);

    // Back on the first screen, Destroy is offered — as its own control.
    await screen.getByRole("button", { name: "Keep the tag as it is" }).click();
    expect(screen.getByRole("button", { name: DESTROY_ENTER_CONTROL })).toBeTruthy();
  });

  it("asks for its own confirmation and states that it permanently disables the tag", async () => {
    await upToDestroy();

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/permanently disables the tag/i);
    expect(text).toMatch(/cannot be recovered or reused/i);
    expect(text).not.toMatch(/may (permanently )?refuse/i);
    // It must not be sold as a way to reuse the tag.
    expect(text).not.toMatch(/written again from this app/i);
  });

  it("sends the destroy operation and the Identity that was confirmed", async () => {
    const { backend, user } = await upToDestroy();

    await user.click(screen.getByRole("button", { name: DESTROY_ACTION_LABEL }));

    await waitFor(() => {
      expect(backend.callsTo("lf_clear")).toHaveLength(1);
    });
    expect(backend.callsTo("lf_clear")[0]?.args).toEqual({
      customer: CARD.customer,
      data32: CARD.data32,
      operation: "destroy",
    });
  });

  it("reports a destroy as completed but needing a check: two chirps, not three", async () => {
    // A destroy the user asked for is not a failure. It is the alphabet's *needs
    // you* because its evidence is an absence, which cannot be told from a tag
    // lifted off the reader — and that is what separates it by ear from a clear.
    const { symbols, stop } = hearSignals();
    const { user } = await upToDestroy();

    await user.click(screen.getByRole("button", { name: DESTROY_ACTION_LABEL }));

    const [toast] = await waitFor(() => {
      expect(toastStore.getState().toasts.length).toBe(2);
      return toastStore.getState().toasts;
    });
    expect(toast?.message).toContain("Destroyed —");
    expect(toast?.message).toMatch(/never accept data again/i);
    expect(toast?.message).not.toMatch(/cleared/i);
    expect(toast?.severity).toBe("warning");
    expect(symbols).toEqual(["done", "needs-you"]);
    stop();
  });

  it("offers no way back to a clear from the result", async () => {
    // The repeat control after a destroy says Destroy, so the destructive flow is
    // never one click from the safe one by accident.
    const { user } = await upToDestroy();

    await user.click(screen.getByRole("button", { name: DESTROY_ACTION_LABEL }));

    expect(await screen.findByRole("button", { name: /Destroy another tag/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Clear another tag/ })).toBeNull();
  });
});

describe("the confirmations tell the truth before the write", () => {
  it("states Clear's writability caveats on screen, as facts not a footnote", async () => {
    await upToClear();

    expect(screen.getByText(/cannot tell whether a tag will accept a write/i)).toBeTruthy();
    expect(screen.getByText(/may permanently refuse every later write/i)).toBeTruthy();
    expect(screen.getByText(/clone an Identity onto it, or author one/i)).toBeTruthy();
  });

  it("never offers, or hints at, a way to check the tag first", async () => {
    // There is no probe, so nothing may invite one (ADR 0007).
    await upToClear();

    expect(screen.getByRole("button", { name: CLEAR_ACTION_LABEL })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep the tag as it is" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/check the tag|check first|probe/i);
  });
});

describe("a tag that will not accept writes", () => {
  it("is reported as such, not as a generic failure or an unknown", async () => {
    const { user } = await upToClear(WILL_NOT_ACCEPT);

    await user.click(screen.getByRole("button", { name: CLEAR_ACTION_LABEL }));

    const [toast] = await waitFor(() => {
      expect(toastStore.getState().toasts.length).toBe(2);
      return toastStore.getState().toasts;
    });
    expect(toast?.message).toContain("This tag will not accept writes.");
    expect(toast?.message).toMatch(/already been written/i);
    expect(toast?.message).toMatch(/never writable/i);
    expect(toast?.severity).toBe("error");
  });

  it("sounds the attention symbol through the seam rather than chirping itself", async () => {
    const { symbols, stop } = hearSignals();
    const { user } = await upToClear(WILL_NOT_ACCEPT);

    await user.click(screen.getByRole("button", { name: CLEAR_ACTION_LABEL }));

    await waitFor(() => {
      // The read that produced the confirmation sounds *done*; the refusal that
      // followed is the attention. Both came through `report`.
      expect(symbols).toEqual(["done", "attention"]);
    });
    stop();
  });

  it("shows what the tag still reads, and never claims a copy or a clear", async () => {
    const { user } = await upToClear(WILL_NOT_ACCEPT);

    await user.click(screen.getByRole("button", { name: CLEAR_ACTION_LABEL }));

    await screen.findByText(/will not accept writes/i);
    expect(screen.getByText(/Still on the tag/)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain(CARD.id);
    expect(text).not.toMatch(/Cleared —/);
    expect(text).not.toMatch(/confirmed cop(y|ies)/i);
    expect(text).not.toMatch(/verified/i);
  });
});
