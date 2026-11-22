# 10 — The Draft list, used: typed at, emptied, cleared, chosen

**Ticket criteria:** "A new report exists for the Draft list, with images for: the
list on arrival with nothing chosen, a query that narrows it, a query that
matches nothing, the query cleared, a Draft chosen, and the write panel that
follows. The new report says plainly what the fixture backend can and cannot
stand for. No claim in either report rests on an image taken before this branch."

**Captured on:** `feat/interface-polish-and-contributing` at `d6eadd2`, 2026-11-22,
from the verification entry point with the fixture backend standing at the Tauri
invoke boundary. Every image in this report was taken in that pass; none of them
predates this branch.

**Where it lives:** **13.56 MHz → Write.** Writing to a 13.56 MHz Tag starts by
choosing a Draft, so that mode's body is the Draft list with a search field over
it and, once a Draft is chosen, the write panel underneath.

## What the fixture backend can and cannot stand for

Every image below was taken with **no Reader attached and no tag in the field**.
`src/dev/deviceStub.ts` answers the device boundary from values written down in
the file; the page that installs it (`e2e.html`) is not a production input.

It **can** stand for:

- that the mode renders, with the whole Draft list on screen at once;
- that the search field is there and narrows the list as characters are typed;
- that a query matching nothing produces the list's own no-match sentence, with
  the count of Drafts that exist;
- that clearing the query restores the list, in its original order;
- that choosing a row marks that row and no other;
- that the write panel appears for the chosen Draft, and what its confirmation
  sentence says about the message and the tag it would replace;
- that no control's label wraps at either viewport.

It **cannot** stand for, and nothing here claims:

- **any tag.** There is no Reader and no tag. The `04 43 8A 01 22 09 03` and the
  `496 bytes` on the confirmation are the fixture's values, not a measurement of
  hardware in front of the machine.
- **any write.** `Write to tag` was never pressed in this pass, and pressing it
  in this build would reach the stub, not an NTAG. **The Draft's Records were not
  written to a Tag.** Nothing in this report says they were, and nothing in it is
  evidence that a write lands, that a read-back verifies, that anything chirps,
  or that an LED lights. Those are the hardware checklist's, and it is unrun.
- **the "exactly one Draft" case.** The search field only appears above more than
  one Draft, and the fixture seeds exactly two. A library of one is covered by a
  component test, not by a screenshot here.
- **a library of several hundred.** The list's bounded height and its scroll are
  what a long library relies on; two Drafts do not exercise them.

## How it was driven

- **Server:** `bun run dev -- --port 1422` in a worktree of this branch; the page
  is `http://127.0.0.1:1422/e2e.html`, which installs the fixture before the app
  renders.
- **Viewports:** 980×760 and 900×700 (`set viewport <w> <h>`, device scale 1).
  Both sets of images are in every step below.
- **Interactions:** every step is a real click on a resolved accessibility ref,
  or real keystrokes into the focused field, in the order a user would make them:
  click the **Write** option, type into **Search Drafts**, clear it with
  Backspace, click a Draft row, click **Check tag**.
- **Nothing was preselected to make an image easier.** The arrival state was
  reached the way a user reaches it: leaving the mode and coming back, which is
  also the state after every visit, because the choice is the mode's own state.

## The six steps

### 1. On arrival, nothing chosen

`draft-list-arrival-980.png` · `draft-list-arrival-900.png`

The group is `role="group"`, named **Draft to write** by the label above it. Both
rows are `role="button"` with `aria-pressed="false"`:

```
Office guest Wi-Fi — 2 Records · 131 bytes · 1d ago     aria-pressed="false"
Desk contact card — 1 Record · 162 bytes · 3d ago       aria-pressed="false"
```

No write panel is on screen: there is no **Check tag** button in the page. The
search field is present, empty, named **Search Drafts**, 384 px wide at both
viewports.

### 2. A query that narrows it — by content, not by name

`draft-list-narrowed-devgo-980.png` · `draft-list-narrowed-devgo-900.png`

Typed **`devgo`**. The list narrows to exactly one row:

```
Desk contact card — 1 Record · 162 bytes · 3d ago       aria-pressed="false"
```

This is the search-by-content proof, and it is deliberately not a name match: the
name is "Desk contact card", which contains no part of "devgo". What answers the
query is authored *inside* its Records — the contact organisation
`Devgo Studio` and the address `hello@devgo.studio`. The other Draft, "Office
guest Wi-Fi", does not match and is gone from the group. Verified, not assumed:
the group's text after typing was the one row above.

### 3. A query that matches nothing

`draft-list-no-match-980.png` · `draft-list-no-match-900.png`

Typed **`passport`**. The group renders the list's own sentence, in the list's own
words, and no rows:

```
No Draft matches “passport”. There are 2 Drafts.
```

The count is the number of Drafts that exist, not the number that matched — that
is the point of it.

### 4. The query cleared

`draft-list-cleared-980.png` · `draft-list-cleared-900.png`

The eight characters were removed with Backspace keystrokes. The field is empty,
the placeholder returns, and both rows are back in their original order:

```
Office guest Wi-Fi — 2 Records · 131 bytes · 1d ago
Desk contact card — 1 Record · 162 bytes · 3d ago
```

Still nothing chosen (`aria-pressed="false"` on both), and still no write panel.

### 5. A Draft chosen

`draft-list-chosen-980.png` · `draft-list-chosen-900.png`

Clicked **Office guest Wi-Fi**. That row alone carries `aria-pressed="true"`, and
the write panel appears below the list:

```
Office guest Wi-Fi — 2 Records · 131 bytes · 1d ago     aria-pressed="true"
Desk contact card — 1 Record · 162 bytes · 3d ago       aria-pressed="false"
```

The panel's heading is **Write to a tag**; its marker control is a **Check tag**
button; its own sentence says what a write would do — "The Draft's Records are
written as one complete NDEF message: a write replaces what the tag holds, and
nothing is appended."

### 6. The write panel that follows

`draft-list-write-panel-980.png` · `draft-list-write-panel-900.png`

Clicked **Check tag**. The panel reads the tag and reports what a write would
replace, before anything is written:

```
Check this
Replace the message on the tag with this Draft?
Writing replaces what the tag holds now: 2 Records, starting with Text hello.
The message needs 134 of the tag's 496 bytes. A write replaces the whole message;
nothing is appended.
tag 04 43 8A 01 22 09 03 · pages 4–37 (34 pages) of user memory
[ the tag's current message, as hex ]
Write to tag     Cancel
Keep the tag on the Reader until the result appears. Polling is suspended while
the write runs.
```

The confirmation is taller than the content column at both sizes, so both images
are framed by scrolling the content column to the panel; what is shown is the
whole confirmation, including its two action buttons. **`Write to tag` was not
pressed.** The image is the confirmation's own rendering and nothing beyond it.

## What was observed along the way

- **Nothing is chosen for you, and the choice is forgotten.** Each viewport's set
  was captured after leaving the Write mode for Read and coming back — the state
  a user returns to — and both rows reported `aria-pressed="false"`, with no
  **Check tag** button in the page. The choice lives in the mode, so leaving the
  mode discards it.
- **Row heights and the list's own limits.** Each row is 380 × 51 px inside a
  384 px group with a 2 px gap, a name over its facts (`2 Records · 131 bytes ·
  1d ago`), with neither line wrapping and both clipped with `truncate`. The
  group's height is capped at `40vh` (measured 280 px at 900×700) and it scrolls
  within that cap, so the write panel below it does not move as the library
  grows. With two Drafts the group is 103 px tall and does not scroll at all.
- **Nothing on this surface wraps at the minimum size.** Measured in the same
  pass as `06-long-label-sweep.md`, in the same way: every control's text nodes
  were ranged and their client rects compared by `top`. At 900×700 the Draft-list
  states contributed 13, 14 and 16 controls with zero wrapped labels. This
  report and the sweep therefore rest on one measurement for that claim, not two.
- **The list's own label stays put.** `Draft to write` and the placeholder
  `Search name, id or content` are the same words at both widths.

## Related

- [06-long-label-sweep.md](06-long-label-sweep.md) — the sweep this shares its
  no-wrap evidence with, including the 13.56 MHz Write states in the table.
- [03-13-56-mhz.md](03-13-56-mhz.md) — Read, Copy, Erase and Memory on the same
  page.
- [The E2E index](README.md) — what all of this is and is not evidence for.
