// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useBeep } from "./useBeep";
import { fakeBackend, renderUi } from "../test/dom";
import { outcomes, report } from "../lib/outcome";

/**
 * The pre-existing audible helper, kept working through the seam.
 *
 * Call sites that have not been rewired still hand `chirp` around as a prop, so
 * it must still beep exactly as it did. What changes is the route: the hook no
 * longer sends the beep frame itself — it emits a `done` symbol through the
 * seam, and the subscriber the hook installs is what reaches the Reader. Ticket
 * 17 deletes the helper along with the props that carry it.
 */

const BEEP_KEY = "pm4studio.beep";

function Harness() {
  const { beepOn, setBeepOn, chirp } = useBeep();
  return (
    <div>
      <button onClick={() => void chirp()}>chirp</button>
      <button onClick={() => setBeepOn(!beepOn)}>toggle</button>
      <button onClick={() => report(outcomes.nothingLatched("read"))}>nothing</button>
      <button
        onClick={() =>
          report(
            outcomes.write("write", {
              customer: 0x55,
              data32: 0x0084_8212,
              readback: null,
              outcome: "failed",
              verified: false,
              message: null,
              confirmedCopies: 0,
              countProblem: null,
            }),
          )
        }
      >
        failure
      </button>
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
});

describe("the legacy chirp", () => {
  it("still beeps when the preference is on", async () => {
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness />);

    await user.click(screen.getByRole("button", { name: "chirp" }));

    await waitFor(() => {
      expect(backend.callsTo("beep")).toHaveLength(1);
    });
  });

  it("stays silent when the preference is off, and keeps the preference stored", async () => {
    localStorage.setItem(BEEP_KEY, "0");
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness />);

    await user.click(screen.getByRole("button", { name: "chirp" }));
    await user.click(screen.getByRole("button", { name: "toggle" }));
    await user.click(screen.getByRole("button", { name: "toggle" }));
    await waitFor(() => {
      expect(localStorage.getItem(BEEP_KEY)).toBe("0");
    });

    expect(backend.callsTo("beep")).toHaveLength(0);
  });

  it("cannot turn an operation into a failure when the beeper does not answer", async () => {
    const backend = fakeBackend({
      beep: () => {
        throw new Error("the beeper did not answer");
      },
    });
    const { user } = renderUi(<Harness />);

    // The click resolves: the rejection is swallowed, as it always was.
    await expect(user.click(screen.getByRole("button", { name: "chirp" }))).resolves.toBeUndefined();
    await waitFor(() => {
      expect(backend.callsTo("beep")).toHaveLength(1);
    });
  });
});

describe("a reported outcome", () => {
  it("beeps because the seam said so, not because a component reached the beeper", async () => {
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness />);

    await user.click(screen.getByRole("button", { name: "failure" }));

    await waitFor(() => {
      expect(backend.callsTo("beep")).toHaveLength(1);
    });
  });

  it("leaves the beeper alone for an outcome whose severity is silent", async () => {
    const backend = fakeBackend({ beep: () => null });
    const { user } = renderUi(<Harness />);

    await user.click(screen.getByRole("button", { name: "nothing" }));
    // One turn of the microtask queue: if a beep were going out, it would have.
    await Promise.resolve();

    expect(backend.callsTo("beep")).toHaveLength(0);
  });
});
