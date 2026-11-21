// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { PasswordProtection } from "./PasswordProtection";
import { fakeBackend, renderUi } from "../test/dom";
import { ACKNOWLEDGEMENT_LABEL, PASSWORD_ACTION_SET, type PasswordAttempt } from "../lib/password";

/**
 * Gate 8 of 8: setting a password on a Tag.
 *
 * This gate is an acknowledgement rather than a dialog: the warning that a lost
 * password makes the Tag permanently unrecoverable is stated before anything is
 * offered, and neither password button can be asked for until the box is ticked.
 * The acknowledgement is required per attempt — it is cleared after each one —
 * so there is no "already agreed" state to inherit.
 *
 * The confirming half proves the request carries the acknowledgement it was
 * given; the dismissing half proves that an unacknowledged request is not merely
 * refused afterwards but cannot be asked for at all.
 */

const REFUSED: PasswordAttempt = {
  outcome: "refused",
  refusal: "cannot-authenticate",
  message: "This Reader cannot authenticate a password-protected Tag, so it will not set one.",
  wouldWritePages: [131, 133, 134],
  wrotePages: [],
};

describe("setting a password", () => {
  it("cannot be asked for before the consequence is acknowledged", async () => {
    const backend = fakeBackend({ hf_password_set: () => REFUSED });
    const { user } = renderUi(<PasswordProtection connected />);

    const set = screen.getByRole("button", { name: PASSWORD_ACTION_SET });
    // The gate is in front of the control, not behind it.
    expect((set as HTMLButtonElement).disabled).toBe(true);

    // The warning is stated before the control is used, not after it is refused.
    expect(screen.getByText(ACKNOWLEDGEMENT_LABEL)).toBeTruthy();

    await user.click(set);

    expect(backend.callsTo("hf_password_set")).toHaveLength(0);
  });

  it("sends the acknowledged request when confirmed", async () => {
    const backend = fakeBackend({ hf_password_set: () => REFUSED });
    const { user } = renderUi(<PasswordProtection connected />);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: PASSWORD_ACTION_SET }));

    await waitFor(() => {
      expect(backend.callsTo("hf_password_set")).toHaveLength(1);
    });
    // The acknowledgement travels with the request; it is not remembered here.
    expect(backend.callsTo("hf_password_set")[0]?.args).toEqual({ acknowledged: true });
  });
});
