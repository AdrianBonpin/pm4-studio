// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { ToastViewport } from "./ToastViewport";
import { renderUi } from "../test/dom";
import { manualTimers } from "../test/clock";
import { createToastStore, type ToastStore } from "../lib/toastStore";
import { outcomes, type Outcome } from "../lib/outcome";
import { TOAST_CORNER_KEY } from "../lib/toastCorner";
import { useToastCorner } from "../hooks/useToastCorner";

/** A probe for the setting the Settings page will own: no UI of its own yet. */
function CornerControl() {
  const { setCorner } = useToastCorner();
  return (
    <button type="button" onClick={() => setCorner("top-left")}>
      Top left
    </button>
  );
}

/**
 * The surface the messages are rendered on.
 *
 * Rendered with no fake backend, because a message must not depend on a Reader:
 * the shell is expected to report a save or a preference with nothing plugged in.
 * What this file checks is what a DOM harness can honestly check — placement,
 * the visible cap, the repeat count, keyboard dismissal, focus, and the polite
 * announcement attributes. Whether a screen reader then reads it politely is
 * beyond jsdom, and is not claimed here.
 */

function setup() {
  const clock = manualTimers();
  const store = createToastStore({ timers: clock.timers });
  return { store, clock };
}

/** Report one outcome the way the seam would, inside an act() boundary. */
function raise(store: ToastStore, outcome: Outcome) {
  act(() => store.push(outcome));
}

afterEach(() => {
  localStorage.clear();
});

describe("a message on screen", () => {
  it("renders nothing at all until something is reported", () => {
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("renders with no Reader attached", () => {
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);

    raise(store, outcomes.announcement("Saved."));

    expect(screen.getByText("Saved.")).toBeTruthy();
  });

  it("is announced politely, one live region per message", () => {
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);
    raise(store, outcomes.tagRead("read", "55 00 84 82 12"));

    const [message] = screen.getAllByRole("status");
    expect(message?.getAttribute("aria-live")).toBe("polite");
    expect(message?.textContent).toContain("Read 55 00 84 82 12.");
  });

  it("does not take focus from what the user is doing", () => {
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);
    const before = document.activeElement;

    raise(
      store,
      outcomes.write("write", {
        customer: 0x55,
        data32: 0x0084_8212,
        readback: null,
        outcome: "failed",
        verified: false,
        message: null,
        refusalCause: null,
        confirmedCopies: 0,
        countProblem: null,
      }),
    );

    expect(document.activeElement).toBe(before);
    expect(document.activeElement).toBe(document.body);
  });

  it("is dismissible from the keyboard", async () => {
    const { store } = setup();
    const { user } = renderUi(<ToastViewport store={store} />);
    raise(store, outcomes.announcement("Saved."));

    await user.tab();
    const dismiss = screen.getByRole("button", { name: "Dismiss: Saved." });
    expect(document.activeElement).toBe(dismiss);

    await user.keyboard("{Enter}");
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("offers the action its outcome carried, and keeps the dismiss beside it", async () => {
    const { store } = setup();
    const reconnect = vi.fn();
    const { user } = renderUi(<ToastViewport store={store} />);
    raise(
      store,
      outcomes.readerFailure("I/O Timeout", {
        action: { label: "Reconnect", run: reconnect },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Dismiss/ })).toBeTruthy();
  });
});

describe("the stack", () => {
  it("shows three and counts the older ones rather than listing them", () => {
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);
    for (let i = 1; i <= 5; i += 1) {
      raise(store, outcomes.tagRead("read", `55 00 84 82 ${i.toString().padStart(2, "0")}`));
    }

    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.getByText("+2 older messages")).toBeTruthy();
  });

  it("says twice for a message that was reported twice", () => {
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);
    const same = outcomes.announcement("Saved.");

    raise(store, same);
    raise(store, same);

    expect(screen.getByText("×2")).toBeTruthy();
  });
});

describe("the corner", () => {
  it("defaults to bottom-right", () => {
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);
    raise(store, outcomes.announcement("Saved."));

    const region = screen.getByRole("region", { name: "Messages" });
    expect(region.getAttribute("data-corner")).toBe("bottom-right");
    expect(region.className).toContain("bottom-4");
    expect(region.className).toContain("right-4");
  });

  it("goes where the stored preference says", () => {
    localStorage.setItem(TOAST_CORNER_KEY, "top-left");
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);
    raise(store, outcomes.announcement("Saved."));

    const region = screen.getByRole("region", { name: "Messages" });
    expect(region.getAttribute("data-corner")).toBe("top-left");
    expect(region.className).toContain("top-4");
    expect(region.className).toContain("left-4");
  });

  it("is a plain region named for what it holds, not a dialog", () => {
    const { store } = setup();
    renderUi(<ToastViewport store={store} />);
    raise(store, outcomes.announcement("Saved."));

    expect(screen.getByRole("region", { name: "Messages" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves when the setting changes, and stores the choice", async () => {
    const { store } = setup();
    const { user } = renderUi(
      <>
        <ToastViewport store={store} />
        <CornerControl />
      </>,
    );
    raise(store, outcomes.announcement("Saved."));
    expect(screen.getByRole("region", { name: "Messages" }).getAttribute("data-corner")).toBe(
      "bottom-right",
    );

    await user.click(screen.getByRole("button", { name: "Top left" }));

    const region = screen.getByRole("region", { name: "Messages" });
    expect(region.getAttribute("data-corner")).toBe("top-left");
    expect(region.className).toContain("top-4");
    // A restart reads this back, which is what makes the choice survive one.
    expect(localStorage.getItem(TOAST_CORNER_KEY)).toBe("top-left");
  });
});
