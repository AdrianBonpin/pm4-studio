// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import App from "./App";
import { DraftsProvider } from "./components/DraftsProvider";
import { fakeBackend, renderUi } from "./test/dom";
import { libraryView } from "./test/libraryState";
import { toastStore } from "./lib/toastStore";
import { DESTROY_PANEL_TITLE } from "./lib/clearTag";

/**
 * The page's width, as the shell declares it.
 *
 * This is seam S4 of the interface-polish spec: the shell's page container as
 * rendered. It catches that the width cap is gone, that every destination still
 * renders with no Reader attached, that the header and the section bodies share
 * one inset, and that the rules separating sections are drawn outside that inset
 * while a rule inside a section body is not.
 *
 * What it cannot catch, and does not pretend to: the painted width. jsdom has no
 * layout, so no assertion here proves that a rule reaches a pixel. The geometry
 * is asserted where the stylesheet states it — in the class list, in Tailwind's
 * own units — and the rendered page at 900×700 and at a maximised window is the
 * evidence for the rest. Nothing about the rules below is faked as layout.
 *
 * No Reader is attached: `connect` rejects, which is the state a machine with no
 * hardware is in.
 */

/** Every destination, in the sidebar's order. */
const DESTINATIONS = ["125 kHz", "13.56 MHz", "Library", "Tools", "Settings"];

/** Tailwind's spacing unit: `px-6` is six of them, and one is 4px. */
const UNIT_PX = 4;

/** The page's one inset, in pixels: 24px between the content area's edges and the text. */
const PAGE_INSET_PX = 24;

function noReader() {
  return {
    library_load: () => libraryView([]),
    beep: () => null,
    connect: () => {
      throw "no such device: failed to open the reader";
    },
  };
}

function renderApp() {
  return renderUi(
    <DraftsProvider>
      <App />
    </DraftsProvider>,
  );
}

function main(): HTMLElement {
  const element = document.querySelector("main");
  if (!element) throw new Error("the shell has no page pane");
  return element;
}

function tokens(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** The horizontal padding an element declares, in pixels — `px-6` is 24. */
function insetOf(element: Element): number | null {
  const token = tokens(element).find((name) => /^px-\d+(\.\d+)?$/.test(name));
  return token ? Number(token.slice("px-".length)) * UNIT_PX : null;
}

/** The horizontal margin an element declares, in pixels — `-mx-6` is -24. */
function marginOf(element: Element): number | null {
  const token = tokens(element).find((name) => /^-mx-\d+(\.\d+)?$/.test(name));
  return token ? -Number(token.slice("-mx-".length)) * UNIT_PX : null;
}

/**
 * The pane the page scrolls in: the element that owns the page's one inset.
 *
 * Found from the page's own heading rather than from a fixed selector, so the
 * shell can grow a wrapper without the test quietly measuring nothing.
 */
function pagePane(): HTMLElement {
  let element: HTMLElement | null = screen.getByRole("heading", { level: 1 }).parentElement;
  while (element && element.parentElement !== main()) {
    element = element.parentElement;
  }
  if (!element) throw new Error("the page heading is not inside the page pane");
  return element;
}

/**
 * The rules a page draws *between* its own parts, as rendered.
 *
 * A rule is page-level when it is not drawn inside a section's body: either it is
 * the section itself, or it belongs to a page group that is not a section (the
 * Settings page's Feedback group is one). Those are the rules the ticket says must
 * reach both edges of the content area.
 */
function pageRules(): Element[] {
  return Array.from(document.querySelectorAll("main *"))
    .filter((element) => tokens(element).includes("border-t"))
    .filter((element) => {
      const section = element.closest("section");
      return section === null || section === element;
    });
}

/** The rules drawn inside a section's body: these keep the body's inset. */
function bodyRules(): Element[] {
  return Array.from(document.querySelectorAll("main section *")).filter((element) =>
    tokens(element).includes("border-t"),
  );
}

/** The elements between the page's heading and the pane it sits in. */
function ancestorsBelowPane(): HTMLElement[] {
  const pane = pagePane();
  const chain: HTMLElement[] = [];
  let element: HTMLElement | null = screen.getByRole("heading", { level: 1 }).parentElement;
  while (element && element !== pane) {
    chain.push(element);
    element = element.parentElement;
  }
  return chain;
}

async function visit(user: ReturnType<typeof renderApp>["user"], destination: string): Promise<void> {
  const nav = screen.getByRole("navigation", { name: "Destinations" });
  await user.click(within(nav).getByRole("button", { name: destination }));
}

afterEach(() => {
  toastStore.clear();
});

describe("the page uses the width it has", () => {
  it("caps no destination in a centred column", async () => {
    fakeBackend(noReader());
    const { user } = renderApp();

    for (const destination of DESTINATIONS) {
      await visit(user, destination);
      for (const element of ancestorsBelowPane()) {
        const capping = tokens(element).filter((name) => /^(max-w-|mx-auto$)/.test(name));
        expect(capping, `${destination}: ${element.tagName.toLowerCase()}`).toEqual([]);
      }
    }
  });

  it("keeps the header and the section bodies at one inset, and draws the section rules outside it", async () => {
    fakeBackend(noReader());
    const { user } = renderApp();

    for (const destination of DESTINATIONS) {
      await visit(user, destination);

      const pane = pagePane();
      expect(insetOf(pane), `${destination}: the page pane's inset`).toBe(PAGE_INSET_PX);
      // The pane's own box is the content area; a rule reaches its edges by
      // reaching past the inset, never by the pane growing a margin.
      expect(marginOf(pane), `${destination}: the page pane's margin`).toBeNull();

      // The header sits in the pane and inherits its inset. It adds none of its
      // own and cancels none, so its text and a section body's text start at the
      // same place.
      const header = document.querySelector("main header");
      expect(header, destination).toBeTruthy();
      if (header) {
        expect(insetOf(header), `${destination}: the header's inset`).toBeNull();
        expect(marginOf(header), `${destination}: the header's margin`).toBeNull();
      }

      const rules = pageRules();
      expect(rules.length, `${destination}: rules the page draws`).toBeGreaterThan(0);
      for (const rule of rules) {
        // The words sit at the page's inset …
        expect(insetOf(rule), `${destination}: the text a rule separates`).toBe(PAGE_INSET_PX);
        // … and the rule is drawn outside it, at exactly its width.
        expect(marginOf(rule), `${destination}: a page rule's extent`).toBe(-PAGE_INSET_PX);
      }
    }
  });

  it("keeps a rule inside a section body at that body's inset, not at the pane's", async () => {
    fakeBackend(noReader());
    const { user } = renderApp();

    // Clear's Destroy block is the in-body divider the spec names: it divides the
    // panel's content, so it lines up with that content rather than cutting the
    // page. (Its colour is another ticket's; this is its extent.)
    await within(screen.getByRole("group", { name: "125 kHz operation" })).findByRole("button", {
      name: "Clear",
    });
    await user.click(
      within(screen.getByRole("group", { name: "125 kHz operation" })).getByRole("button", {
        name: "Clear",
      }),
    );

    const destroyHeading = await screen.findByText(DESTROY_PANEL_TITLE);
    const divider = destroyHeading.parentElement;
    expect(divider, "the Destroy block").toBeTruthy();
    if (divider) {
      expect(tokens(divider), "the Destroy divider").toContain("border-t");
      // Not promoted to the pane's width, and not inset twice either: it inherits
      // the section body's inset because it is inside it.
      expect(marginOf(divider), "the Destroy divider's margin").toBeNull();
      expect(insetOf(divider), "the Destroy divider's inset").toBeNull();
      expect(insetOf(divider?.closest("section") ?? document.body)).toBe(insetOf(pagePane()));
    }

    // And no rule inside a section body is promoted to the pane's width: a body
    // divider divides what is beneath its heading rather than cutting the page.
    expect(bodyRules().length).toBeGreaterThan(0);
    for (const rule of bodyRules()) {
      expect(marginOf(rule), rule.tagName.toLowerCase()).toBeNull();
      expect(insetOf(rule), rule.tagName.toLowerCase()).toBeNull();
    }
    for (const element of Array.from(document.querySelectorAll("main section *"))) {
      expect(marginOf(element), element.tagName.toLowerCase()).toBeNull();
    }
  });
});
