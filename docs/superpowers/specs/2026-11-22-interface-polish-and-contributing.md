# Interface polish and a contribution guide

**Baseline:** fc0d763c48b17058daf97595777380105e97611c   **Branch:** feat/interface-polish-and-contributing   **Date:** 2026-11-22

This spec holds two independent workstreams that arrived as one request and share
no files: **Part A**, the interface polish (the switcher shape, the page's width,
and the 13.56 MHz Draft choice), and **Part B**, a contribution guide. They are
recorded together here and must be planned as two ticket groups.

---

## Problem Statement

**The switcher is the wrong shape.** The control that switches a band page between
Read, Write, Clear, Clone and Batch — and the four other places the app asks "which
one of these?" — is drawn as a row of fully rounded pills with 6px of padding above
and below the label. It is the most-seen control in the app and the user does not
like it: the corners are rounder than anything else on screen, and the vertical
padding makes each option taller than the row of content it sits above. Two more
chip-shaped controls are hand-rolled rather than built from the one component, and
one of them (the console's seven presets) is not a selection at all — it is a row of
buttons drawn to look like one.

**The horizontal rules stop short of the frame.** Every page sits inside a 768px
column centred in the window, inset another 32px, so the hairline that separates one
section from the next floats in the middle of the pane with empty space on both
sides. At a maximised window the column is a letterbox, which is also what
`DESIGN.md` promises this app does *not* do for two-pane and table pages.

**The Draft dropdown does not scale.** Writing to a 13.56 MHz Tag starts by choosing
a Draft from a native `<select>`. It works for five Drafts; the library has no count
limit, and finding one by name in a menu of several hundred is guesswork with no way
to type at it.

**And there is no contribution guide.** Commit subjects in this repository are split
between Conventional Commits (`feat:`, `fix:`, `style:`) and squash-merged PR titles
(`Studio Redesign: one outcome seam… (#31)`). There is nothing that says which is
expected, so the next commit is a coin toss.

## Solution

**Part A.** The switcher becomes a row of cornered chips — 4px corners, 2px above
and below the label — the same shape in all six places it appears. Action buttons
follow it most of the way out of the pill shape (6px), leaving exactly one pill in
the app: the Toggle, which is a physical switch and reads as one. The two hand-rolled
chip rows become the component they should have been: the AuthorIdentity mode pair
becomes a switcher, and the console presets become ghost buttons. Pages lose the
768px column and 32px inset in favour of a 24px inset with the section rules running
the full width of the pane, so each section is separated by a rule that reaches both
edges of the content area. Writing to a 13.56 MHz Tag now shows the Drafts as a list
with a search field over it, which finds a Draft by its name or by anything authored
inside it.

**Part B.** A `CONTRIBUTING.md` that states the commit and PR-title convention the
repository actually follows, in one page, with the workflow that surrounds it.

## User Stories

**The switcher**

1. As the person using the app, I want the mode switcher to look like the rest of the interface — square-ish corners, no bulk above and below the word — so that the numbers stay the loudest thing on the screen.
2. As the person using the app, I want the same switcher shape on every page, so that "which one is current?" is answered the same way whether I am choosing a band mode, a Collection, a Settings group, a Quiet level or a Toast corner.
3. As the person using the app, I want the current option to be unmistakable — its border in the accent, its surface raised — so that I can see which mode I am in without reading.
4. As a keyboard user, I want to Tab to the switcher and press Enter or Space to choose, so that the control is usable without a mouse.
5. As a screen-reader user, I want the switcher announced as one labelled group with each option reporting whether it is pressed, so that I know what I am choosing between.
6. As a mouse user on a 900×700 window, I want every option's label on one line, so that the row does not reflow when a label is long.
7. As the person using the app, I want the AuthorIdentity mode pair to be the same control as everywhere else, so that two ways of entering an Identity do not look like two different kinds of decision.
8. As the person using the app, I want the console's frame presets to look like the actions they are, so that pressing one is not mistaken for choosing a mode.

**The page's width**

9. As the person using the app, I want the hairline between sections to reach both edges of the content area, so that a page reads as one panel rather than as a column in a box.
10. As the person using the app on a maximised window, I want the page to use the width it has instead of a centred letterbox, so that a list and its detail sit beside each other with room to spare.
11. As the person using the app, I want a field or a paragraph never to stretch to the width of a maximised window, so that reading and typing stay comfortable.
12. As the person using the app, I want a rule *inside* a section — the one above Destroy on the Clear panel — to line up with that section's content, so that it divides what is beneath the heading rather than cutting the page.
13. As the person using the app, I want that Destroy divider to be visible at all, so that the destructive entry point is not the one block on the page with no separation above it.

**The Draft list**

14. As the person writing a Draft to a Tag, I want to see all my Drafts as a list rather than one at a time in a menu, so that I can see what I have to choose from.
15. As the person writing a Draft to a Tag, I want to type part of a Draft's name and have the list narrow as I type, so that a library of several hundred stays usable.
16. As the person writing a Draft to a Tag, I want the search to find a Draft by what is inside it — a URL, a phone number, a Wi-Fi name, a line of text — so that remembering the content is enough when the name is forgotten.
17. As the person writing a Draft to a Tag, I want nothing chosen for me, so that a Tag is never written with a Draft the page picked.
18. As the person writing a Draft to a Tag, I want to see each Draft's Record count, encoded size and how long ago it changed, so that I can tell two similarly named Drafts apart.
19. As the person writing a Draft to a Tag, I want to be told in words when nothing matches what I typed, and how many Drafts exist, so that an empty list is never a mystery.
20. As the person writing a Draft to a Tag, I want a long list to scroll within a bounded height, so that the action that follows stays where it was.
21. As the person writing a Draft to a Tag and then leaving the mode, I want my choice to be forgotten, so that returning later cannot silently write a Draft I chose for a different tag.
22. As someone with exactly one Draft, I want to be shown it without a search field over it, so that a one-item list carries no machinery.
23. As a keyboard user, I want to reach the search field, type, and then Tab into the results, so that narrowing and choosing needs no mouse.

**The contribution guide**

24. As someone about to commit to this repository, I want one page that tells me the commit message shape and the allowed types, so that I do not have to infer the convention from history that does not follow one.
25. As someone opening a pull request, I want to know that the PR title must itself be a Conventional Commit subject, so that squash-merge leaves `prod` with a readable history by construction.
26. As someone opening a pull request, I want to know the branch → PR → squash-merge flow and that `prod` is never committed to directly, so that I follow the same path as everyone else.
27. As someone reading the history in a year, I want to know that the pre-guide subjects were not rewritten, so that their absence from the convention is explained rather than surprising.
28. As someone wondering whether any of this is enforced, I want the guide to say plainly that it is not, so that I do not infer a status check that does not exist.

## Constraints & Non-Negotiables

- **The design gate is a gate.** `bun run design:check` runs inside `bun run build` and therefore inside `bun run verify`. A detector rule violated by the new classes fails verification, not just review. No new allow-list entry may be added to push a finding through; `src/index.css` is normative and unchanged by this work.
- **The 900×700 minimum window is the layout's real constraint.** No control wraps onto a second line at that size, switcher labels included.
- **gridline stays the world.** No shadow, no gradient, no second accent, no light theme. The change is to radii, padding and width, not to the palette or the two type families.
- **The accent still means "you can act here" and "this one is current".** The switcher's active option keeps its accent border; nothing new borrows the accent.
- **Wide windows must not stretch a measurement.** Removing the 768px column is not permission for a 1300px-wide text field or a paragraph set to the pane. Rules and two-pane layouts take the full width; a form group and a prose block keep a measure. This is a constraint on the work, not a later review note.
- **No change to the Rust side, the library file schema, or the protocol.** Every Draft this work lists is a Draft the app already holds in memory; the picker makes no new backend call and reads no file.
- **The contribution guide is descriptive.** No CI, no commit hook, no status check is introduced. A guide that implies enforcement it does not have is worse than one that does not claim it.
- **The guide describes GitHub.** `origin` is `git@github.com:AdrianBonpin/pm4-studio.git`; PR commands are `gh`. This repository is a genuine exception to the Gitea/`tea` default and the guide says so by naming the host, not by inheriting the wrong one.
- **`bun run verify` is the claim of done.** Design gate, then types, then vitest, then the Rust suite.

## Boundaries

**In scope**

- The switcher's shape and padding, in the component and at all six call sites, plus folding the AuthorIdentity mode pair into it.
- The console presets changing from chips to ghost buttons.
- Action buttons moving from pill to 6px; DESIGN.md updated to match.
- The shell's page width: the cap removed, the 24px inset, page-level rules full width, in-panel rules inset.
- `ClearTag`'s invisible `border-line` divider made visible.
- The 13.56 MHz Draft choice becoming an always-visible list with search over Draft name, id and authored Record values.
- `CONTRIBUTING.md`, linked from `README.md`.
- ADR 0010, and the `DESIGN.md` and `GLOSSARY.md` edits this work makes necessary.
- Re-capturing the E2E screenshot corpus at both viewports, plus one new flow for the Draft list.

**Out of scope**

- **A search field on Library → Drafts.** It has none today and Snapshot search has one; this work makes that asymmetry more visible without fixing it. See Open Questions.
- **CI enforcement of the commit or PR-title convention.**
- **Rewriting existing commit history** to fit the convention.
- **Changing the Toggle**, the input radius (8px), the card radius (12px) or the badge radius (4px).
- **Replacing the remaining native selects** — Record type, Wi-Fi authentication and encryption — which are short fixed enumerations and keep working as they are.
- **A joined segmented track or a tab-strip treatment.** Both were shown as prototypes and rejected.
- **Any change to Library's sort controls**, which are action buttons and not a switcher.

## Implementation Decisions

**The switcher.** One component owns the shape: a 4px corner, 2px above and below the label, 10px left and right, 14px Outfit, `nowrap`, a hairline border, and a raised surface with an accent border when pressed. The component keeps its current contract — one `role="group"` with an accessible name, one button per option carrying `aria-pressed`, options in given order — because the page tests already read that contract and because it is what a screen reader needs. Two call sites stop being hand-rolled: AuthorIdentity's two-way mode pair becomes this component (it is structurally identical), and the console's seven presets become `ghost` Buttons, because pressing one fills a field rather than changing a mode.

**Buttons.** They leave the pill shape for the 6px small-control radius. The Toggle keeps its pill. `DESIGN.md`'s Shapes section and its "keep one primary action, pill-shaped" rule are rewritten rather than left contradicting the code: the surviving rule is that one primary action exists per visible mode and it never wraps, and the pill is the switch's shape, not the button's.

**The page's width.** The shell's page container loses its width cap and its 32px inset, keeping 24px. The section divider is drawn by the section component and spans the container; dividers *inside* a section body stay aligned with that body's inset and keep doing so. `ClearTag`'s Destroy divider is drawn with the defined border colour instead of the token that does not exist. Where a form group or a prose block would otherwise stretch, it keeps a measure — the constraint above, applied per group during implementation.

**The Draft list.** Write mode renders a labelled group of rows, one per Draft, each showing the Draft's name and its Record count, encoded size and age; the row that is chosen is marked with `aria-pressed`. A search field sits above the group and appears only when there is more than one Draft. Typing narrows the group through a pure filter in the Drafts module: a case-insensitive substring over the Draft's name, its id, and the authored values inside its Records (text bodies, URLs, phone numbers, email addresses, contact name and organisation, SSIDs and keys). There is **one** comparison rule in this codebase, not two: the substring-and-whitespace-compaction test that Snapshots already use is exported from the library module that owns it, and the Drafts filter calls it with its own fact text. A Draft and a Snapshot have different facts, so each owns its `searchableText` equivalent; neither owns a second matching rule. An empty query returns the same array untouched. No Draft is preselected; the choice lives in the mode's own state and is discarded when the mode unmounts, as every mode's state already is. A query that matches nothing says so in words and states how many Drafts exist. The group caps its height and scrolls within it, the way both Collections' lists already do. The comment in the native-select module that argues native selection is right *because* the Drafts a Tag can receive may grow is rewritten to state ADR 0010's policy instead.

**Documentation.** `CONTRIBUTING.md` covers: Conventional Commits 1.0.0 with its eleven standard types and no invented ones — `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`; optional scopes drawn from the app's vocabulary (`lf`, `hf`, `library`, `drafts`, `settings`, `tools`, `reader`, `protocol`, `ui`, `design`, `docs`); imperative lowercase subjects with no trailing period and a 72-character ceiling; `!` before the colon plus a `BREAKING CHANGE:` footer for a break; PR titles in the same shape because squash-merge makes the title the commit on `prod`; the branch → PR → squash-merge → delete flow; that the convention applies from the guide's landing and history is not rewritten; that it is not enforced; and `bun run verify` as the pre-PR gate. `README.md` links it once.

**The prototype is not an artifact.** The throwaway pages used to settle the switcher shape and the rule extent stay untracked and are deleted before this branch's first commit.

## Testing Decisions

**Seams.** These are the eight approved interfaces. Phase 2 writes tickets against them; Phase 3 verifies there.

| # | Seam | Catches | Misses |
|---|---|---|---|
| S1 | The Drafts module's pure search (`draftMatches`, `filterDrafts`) | name, id and authored Record values matching; case and whitespace tolerance; an empty query returning the list untouched; a Draft with an unencodable Record still being listed | whether the screen shows the result |
| S2 | The Write mode's Draft list, rendered through the 13.56 MHz page | the search field appearing only above one Draft; narrowing as you type; the no-match sentence and its count; nothing preselected; choosing a Draft revealing the write panel; leaving the mode clearing the choice | pixel shape, scroll height, and the painted row height |
| S3 | The switcher component's contract | one labelled group; exactly one option pressed; option order preserved; every label `nowrap` | corner radius and padding — visual only |
| S4 | The shell's page container | the width cap is gone; every destination still renders with no Reader attached; the header and the section bodies share one inset, and the rules that separate sections are drawn outside it | the painted width — jsdom has no layout, so any test of "the rule reaches the edge" is a review or E2E matter |
| S5 | `bun run design:check` as a gate | every rule the vendored detector encodes; an allow-list entry without a reason or naming a rule that no longer exists | the specific radius and padding values, which are not rules it encodes |
| S6 | The E2E capture pass at 900×700 and 980×760 | that each page and mode renders; that no control's label wraps at the minimum; that the Draft list narrows, reports no match, and hands the chosen Draft to the write panel | anything about real hardware |
| S7 | A source scan for undefined colour tokens | `border-line` and any future `border-<token>` that names nothing | other typo'd utilities |
| S8 | — none — | the contribution guide is stated, not enforced; it is verified by reading, and its drift is a review matter | everything |

**What makes a good test here.** Public behaviour, not implementation: the pure filter is tested as a function of a Draft and a query with an expected list; the list is tested by rendering the page and typing, with the expected names written out independently of the filter's own logic. No app-internal module is mocked — the existing suite's rule. The Tauri invoke boundary is stubbed through `src/test/dom.tsx`, as every component test already does.

**Prior art.** `library.test.ts` for the Search rule's shape; `DraftsCollection.test.tsx` and `LibraryPage.detail.test.tsx` for list-and-detail interaction; `App.shell.test.tsx` for the shell's no-Reader rule; `designCheck.test.ts` for how a gate is tested against its own allow-list.

**Existing tests that must change.** The assertions in `HfPage.workspace.test.tsx` that use `role="combobox"` named "Draft to write" as their marker for "the Write mode is showing" move to the new list's role and name. `platform.test.ts` asserts the input radius is `rounded-lg`, which is unchanged. No suite asserts a button's or the switcher's radius today.

**E2E: OPTED-IN.** Critical flows: every destination at 900×700 and 980×760 with the real fixture backend; each band page's mode switching; Library's two Collections with and without a selection; Settings' groups; and one new flow for the Draft list — type a query that matches, type one that matches nothing, clear it, choose a Draft, and see the write panel appear. The committed corpus is re-captured at both viewports because the shell's width changes on every page. The corpus proves rendering and non-wrapping; it proves nothing about hardware, as its own README states.

## Migration & Rollback

No migration. The library file, its schema and its version are untouched; no persisted key is added, so ADR 0005 is not engaged. There is no compatibility surface: the app is a single-user desktop binary and nothing outside it reads these classes.

Rollback is `git revert` of the branch's squash commit. The one thing that is not free to reverse is the committed E2E corpus: re-captured screenshots are part of the diff, so a revert restores the previous capture set along with the code that produced it. `DESIGN.md` is the record of the committed visual world, so a rollback includes restoring the two pill rules and the layout section it rewrites.

## Domain Model

**GLOSSARY.md gains two entries**, both about language rather than implementation:

- **Switcher** — the interface's one control for choosing exactly one of a handful of options in place, used for band modes, Collections, Settings groups, Quiet level and the Toast corner. It is not a tab strip: it owns no panel, hides nothing from find-in-page, and needs no arrow-key roving focus. *Avoid*: chip, tab, tab strip, segmented control, pill. This is the word tickets and commit scopes use.
- **Search** — the affordance that narrows a list by what the user types, matching a case-insensitive substring over the fact text of each item with whitespace compacted, and returning the list untouched when nothing is typed. One rule, both Collections. *Avoid*: filter, query, find, quick-find, fuzzy search. (The 13.56 MHz Draft list and Library's Snapshots both use it; neither is a "fuzzy" match and the word may not imply ranking.)

A flagged-ambiguity entry records that "chip" named three different things — the mode switcher, the AuthorIdentity mode pair and the console presets — and that two of them were never chips: the switcher is a **Switcher**, the presets are **buttons**.

**ADR 0010 — A growing list of choices is an in-app list with search, not a native menu.** Hard to reverse in the sense that matters: it sets the policy every future picker inherits, and the module that implements native selection currently carries a comment arguing the opposite for exactly this list. Surprising without the context that a native menu cannot be searched. A real trade-off: the platform menu is familiar and keyboard-complete, and this gives that up for findability past a few dozen entries.

## Open Questions

- **Library → Drafts has no search.** Snapshots do; Drafts do not, and the two share a page and a Collection switch. Its owner is the user, and it must be resolved before or during the next Library change — this work deliberately does not decide it.
- **Whether the token scan (S7) is a script or a test.** Its owner is the implementer; it must be settled in Phase 2, because its home decides whether it can fail `bun run test` or only `bun run verify`.
- **Which form groups keep a measure at wide windows.** The set is decided during implementation under the stated constraint; if any group turns out to need a decision that the constraint cannot settle, it returns here rather than being picked silently.
- **CI enforcement of the convention.** Declined for now, by the user. Revisit if history drifts after the guide lands.
