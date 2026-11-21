// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Notice, NOTICE_TONES, type NoticeTone } from "./Notice";

/**
 * The one notice treatment, held to the six things ticket 18 says it must keep.
 *
 * A notice is a condition the user is in: a library file that cannot be written
 * to, a migration warning, an invalid Record, a pending confirmation. It used to
 * be drawn as a coloured rule down the left edge of a rounded box, which
 * announced the severity with a bar and nothing else — no word said which case it
 * was, so a user who cannot tell the accent hues apart got one bar for three
 * different meanings.
 *
 * The replacement is a whole box: a border on all four sides, a tint of the same
 * hue, a leading word that names the severity, and an icon whose *shape* differs
 * per tone. The last two are the channels that survive colour blindness, which is
 * why they are asserted here rather than described in a comment.
 *
 * These are the primitive's own properties. That each site kept its words, its
 * severity and its dismiss control is asserted where the site is rendered.
 */

/** The icon shape lucide put in the markup, e.g. `octagon-alert`. */
function iconShape(container: HTMLElement): string | null {
  const svg = container.querySelector("svg");
  const cls = svg?.getAttribute("class") ?? "";
  return /lucide-([a-z-]+)/.exec(cls)?.[1] ?? null;
}

describe("the notice", () => {
  it("is a whole box — a border on every side and a tint — not a bar down one side", () => {
    const { container } = render(<Notice tone="err" label="Failed" />);
    const root = container.firstElementChild as HTMLElement;

    // `border`, which is all four sides, and never the 2px left rule the
    // redesign removes.
    expect(root.className).toMatch(/(^|\s)border(\s|$)/);
    expect(root.className).not.toContain("border-l");
    // The tint: severity is also a filled surface, so the box reads as a state.
    expect(root.className).toContain("bg-err/10");
  });

  it("names its severity in words, in every tone", () => {
    for (const tone of NOTICE_TONES) {
      const { container, unmount } = render(<Notice tone={tone} label={`Severity: ${tone}`} />);

      expect(screen.getByText(`Severity: ${tone}`)).toBeTruthy();
      expect((container.firstElementChild as HTMLElement).dataset.tone).toBe(tone);
      unmount();
    }
  });

  it("gives every tone an icon of its own shape, so the shape carries the severity", () => {
    const shapes = new Map<NoticeTone, string | null>();
    for (const tone of NOTICE_TONES) {
      const { container, unmount } = render(<Notice tone={tone} label={`Severity: ${tone}`} />);
      shapes.set(tone, iconShape(container));
      unmount();
    }

    // Every tone, a shape.
    for (const tone of NOTICE_TONES) {
      expect(shapes.get(tone), `tone ${tone} renders no icon`).not.toBeNull();
    }
    // And no two tones share one: a shape that stood for two severities would
    // carry nothing.
    expect(new Set(shapes.values()).size).toBe(NOTICE_TONES.length);
    // Distinct from the words, too: two channels, not one written twice.
    expect(shapes.get("err")).not.toBe(shapes.get("warn"));
    expect(shapes.get("warn")).not.toBe(shapes.get("ok"));
  });

  it("keeps the icon out of the accessible name, which is the words", () => {
    const { container } = render(<Notice tone="err" label="Not written" />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives a notice that is announced an accessible name from its own words", () => {
    render(<Notice tone="err" role="status" label="Not written" title="The tag never answered" />);

    const notice = screen.getByRole("status", { name: "Not written" });
    // The severity is the name; what the condition is stays readable inside it.
    expect(notice.textContent).toContain("The tag never answered");
  });

  it("stays out of the live regions unless it is asked to be one", () => {
    // A condition that was already true when the page opened is not an event: it
    // must not be announced as one, which is what a role here would do.
    const { container } = render(<Notice tone="warn" label="Check this" />);

    expect(container.innerHTML).not.toContain("aria-live");
    expect((container.firstElementChild as HTMLElement).getAttribute("role")).toBeNull();
  });

  it("stays dismissible, from the keyboard, with a name that says what it dismisses", async () => {
    const dismissed = vi.fn();
    const user = userEvent.setup();
    render(<Notice tone="warn" label="Not erased" onDismiss={dismissed} />);

    const button = screen.getByRole("button", { name: "Dismiss: Not erased" });
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expect(dismissed).toHaveBeenCalledTimes(1);
  });
});
