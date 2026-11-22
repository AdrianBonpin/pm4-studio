// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { HfPage } from "./HfPage";
import { DraftsProvider } from "../components/DraftsProvider";
import { fakeBackend, renderUi } from "../test/dom";
import { libraryState } from "../test/libraryState";
import { HF_MODE_LABEL, type HfMode } from "../lib/hfWorkspace";
import { newPhoneRecord, newTextRecord, newUrlRecord, newWifiRecord } from "../lib/drafts";
import type { Draft, DraftsView } from "../lib/drafts";

/**
 * Ticket 05 — choosing a Draft by its name or by what is inside it.
 *
 * 13.56 MHz Write mode lists every Draft instead of hiding them one at a time in
 * a menu, and a search field above the list narrows it. The page is mounted as
 * the shell mounts it, inside the Drafts provider, with the mode held above it so
 * that leaving the mode and returning can be exercised. Only the Tauri boundary
 * is faked.
 *
 * The names a query is expected to leave behind are written out here rather than
 * derived from the filter's own logic: these tests are about what the page shows,
 * not about how the filter decides.
 *
 * What these tests hold, beyond the shape:
 *   - nothing is chosen for the user, ever;
 *   - the search field appears only when a one-item list would be machinery;
 *   - a query that matches nothing is a sentence with the count in it;
 *   - the choice lives in the mode, so leaving it forgets the Draft;
 *   - narrowing and choosing take the keyboard alone.
 */

/** Two hours before the test runs, so an age can be read without a frozen clock. */
function twoHoursAgo(): string {
  return new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
}

const WORKSHOP: Draft = {
  id: "draft-workshop",
  name: "Workshop keys",
  updatedAt: twoHoursAgo(),
  records: [newUrlRecord("https://dockyard.example/garage")],
};

const GUEST: Draft = {
  id: "draft-guest",
  name: "Visitor wifi",
  updatedAt: twoHoursAgo(),
  records: [newWifiRecord({ ssid: "Harbour Guest", networkKey: "tidewater77" })],
};

const OFFICE: Draft = {
  id: "draft-office",
  name: "Site office",
  updatedAt: twoHoursAgo(),
  records: [newTextRecord("en", "Ring the bell"), newPhoneRecord("+4489012345")],
};

const ALL_DRAFTS = [WORKSHOP, GUEST, OFFICE];

/** The Drafts collection the app's store would have read at launch. */
function draftsView(drafts: Draft[]): DraftsView {
  return { drafts, problem: null, migrationWarning: null };
}

/** The page inside the provider that owns the Drafts queue, with the mode above it. */
function mount(drafts: Draft[]) {
  const backend = fakeBackend({ drafts_load: () => draftsView(drafts) });

  function Workspace() {
    const [mode, setMode] = useState<HfMode>("read");
    return (
      <HfPage
        connected
        mode={mode}
        onModeChange={setMode}
        onPoll={async () => null}
        library={libraryState()}
        onOpenDraft={() => {}}
      />
    );
  }

  const ui = renderUi(
    <DraftsProvider>
      <Workspace />
    </DraftsProvider>,
  );
  return { backend, ui };
}

/** The workspace's mode switch. */
function modeSwitch() {
  return screen.getByRole("group", { name: "13.56 MHz mode" });
}

/** Enter Write mode, as the user does. */
async function openWrite(user: ReturnType<typeof mount>["ui"]["user"]) {
  await user.click(within(modeSwitch()).getByRole("button", { name: HF_MODE_LABEL.write }));
}

/** The Draft list, as the mode renders it. */
function draftList() {
  return screen.getByRole("group", { name: "Draft to write" });
}

/** One row per Draft, in the order the library holds them; none when nothing matches. */
function rows() {
  return within(draftList()).queryAllByRole("button");
}

/** The search field, which only exists once there is more than one Draft. */
function searchField() {
  return screen.queryByRole("textbox", { name: "Search Drafts" });
}

/** The write flow's first action, which exists only once a Draft is chosen. */
function checkTag() {
  return screen.queryByRole("button", { name: "Check tag" });
}

describe("the Draft list in Write mode", () => {
  it("lists every Draft with its name, its Record count, its encoded size and its age", async () => {
    const { ui } = mount(ALL_DRAFTS);
    await openWrite(ui.user);

    const shown = rows().map((row) => row.textContent ?? "");

    expect(shown).toHaveLength(3);
    expect(shown[0]).toContain("Workshop keys");
    expect(shown[0]).toContain("1 Record");
    expect(shown[0]).toMatch(/\d+ bytes/);
    expect(shown[0]).toContain("2h ago");

    expect(shown[1]).toContain("Visitor wifi");
    expect(shown[1]).toContain("1 Record");

    expect(shown[2]).toContain("Site office");
    expect(shown[2]).toContain("2 Records");
  });

  it("shows no search field over a single Draft, and still makes the user choose it", async () => {
    const { ui } = mount([OFFICE]);
    await openWrite(ui.user);

    expect(searchField()).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.getAttribute("aria-pressed")).toBe("false");
    // Listed, not chosen: there is no write panel yet.
    expect(checkTag()).toBeNull();
  });

  it("chooses nothing when the mode opens", async () => {
    const { ui } = mount(ALL_DRAFTS);
    await openWrite(ui.user);

    for (const row of rows()) expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(checkTag()).toBeNull();
  });

  it("narrows the list as the user types, by name and by what is inside a Draft", async () => {
    const { ui } = mount(ALL_DRAFTS);
    await openWrite(ui.user);

    await ui.user.type(searchField() as HTMLElement, "visitor");
    expect(rows().map((row) => row.textContent ?? "")).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("Visitor wifi");

    // A Draft is not only findable by its name: "garage" is inside a URL Record
    // of Workshop keys and appears nowhere else.
    await ui.user.clear(searchField() as HTMLElement);
    await ui.user.type(searchField() as HTMLElement, "garage");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("Workshop keys");

    // And an id still finds its Draft.
    await ui.user.clear(searchField() as HTMLElement);
    await ui.user.type(searchField() as HTMLElement, "draft-office");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("Site office");
  });

  it("says in words when nothing matches, and how many Drafts there are", async () => {
    const { ui } = mount(ALL_DRAFTS);
    await openWrite(ui.user);

    await ui.user.type(searchField() as HTMLElement, "zzzz");

    expect(rows()).toHaveLength(0);
    expect(within(draftList()).getByText(/No Draft matches/)).toBeTruthy();
    expect(within(draftList()).getByText(/3 Drafts/)).toBeTruthy();
  });

  it("opens the write panel for the Draft the user chose", async () => {
    const { ui } = mount(ALL_DRAFTS);
    await openWrite(ui.user);

    await ui.user.click(within(draftList()).getByRole("button", { name: /Site office/ }));

    const chosen = rows().find((row) => row.getAttribute("aria-pressed") === "true");
    expect(chosen).toBeTruthy();
    expect(chosen?.textContent).toContain("Site office");
    expect(rows().filter((row) => row.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(checkTag()).toBeTruthy();
  });

  it("forgets the choice when the mode is left and returned to", async () => {
    const { ui } = mount(ALL_DRAFTS);
    await openWrite(ui.user);
    await ui.user.click(within(draftList()).getByRole("button", { name: /Workshop keys/ }));
    expect(checkTag()).toBeTruthy();

    await ui.user.click(within(modeSwitch()).getByRole("button", { name: HF_MODE_LABEL.read }));
    await openWrite(ui.user);

    for (const row of rows()) expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(checkTag()).toBeNull();
  });

  it("narrows and chooses with the keyboard alone", async () => {
    const { ui } = mount(ALL_DRAFTS);
    await openWrite(ui.user);

    // The mode switch is where the keyboard is; the search field is its next
    // stop once the switch is passed, and the rows come after the field.
    within(modeSwitch()).getByRole("button", { name: HF_MODE_LABEL.memory }).focus();
    await ui.user.tab();
    expect(document.activeElement).toBe(searchField());

    await ui.user.keyboard("harbour");
    expect(rows()).toHaveLength(1);

    await ui.user.tab();
    expect(document.activeElement).toBe(rows()[0]);

    await ui.user.keyboard("{Enter}");
    expect(rows()[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(checkTag()).toBeTruthy();
  });
});
