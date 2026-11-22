# 04 — Library: both collections, with and without a selection

**Ticket criterion:** Library in both collections, with nothing selected and with
an item open in the detail pane, at both sizes.

**What the screenshot shows:** the library is read through the Rust store, which
is not running here, so the fixture answers `library_load` and `drafts_load` with
two Snapshots and two Drafts. The layout, the selection behaviour and the editor
are the app's. Vite on port 1421 against `e2e.html` with
`src/dev/deviceStub.ts` at the invoke boundary; branch
`ticket/07-e2e-destinations` off integration `d6eadd2`.

| State | 980×760 | 900×700 |
|---|---|---|
| Snapshots, an item open | `library-snapshots-selected-980.png` | `library-snapshots-selected-900.png` |
| Snapshots, nothing selected | `library-snapshots-none-980.png` | `library-snapshots-none-900.png` |
| Drafts, an item open | `library-drafts-selected-980.png` | `library-drafts-selected-900.png` |
| Drafts, nothing selected | `library-drafts-none-980.png` | `library-drafts-none-900.png` |

## What holds

- **Two panes, list beside detail, at both sizes.** On arrival the first item of
  the Collection opens in the right pane; selecting the open item again shuts it
  into the explicit *Nothing selected* state, never a blank pane. The Snapshot
  copy is "Choose a Snapshot from the list to rename it, add a note, or write it
  back to a tag."; the Draft copy is "Choose a Draft from the list to edit its
  Records, or to write it to a tag."
- **Two Collections, one page.** The Collection switcher is the same 4px chip row
  as the band modes — one labelled group, `aria-pressed` on the current
  Collection — and it owns nothing: switching Collection swaps the list and the
  detail, and Drafts is still not a destination in the sidebar.
- **Snapshots: the list is facts, the pane is the editor.** The list rows read
  `Front door — 55 00 84 82 12` and `Lobby poster — 04 43 8A 01 22 09 03`, with
  the sort pair *Name* / *Newest first* beside the search field
  (`Search name, Identity or UID`). The pane carries the Identity with a copy
  button, "facility 132 · card 33298 · 2d ago", "2 confirmed copies", then *Name*,
  *Note*, *Save* / *Revert* (both disabled until something changes), the
  write-back block and *Delete Front door* behind its own confirmation.
- **Drafts: the Records editor sits beside the list**, never below an unrelated
  panel — the Draft's *Name* with *Delete* beside it, then `RECORDS  2 Records ·
  131 bytes` with "Target capacity is not known, so 131 bytes is not compared
  against it", then each Record with its kind, encoded size, summary, move-up /
  move-down / delete, then the add-a-Record row (a Record-type select and *Add
  Record*), and finally *Write to a tag* with *Check tag*. The Wi-Fi Record's
  authentication and encryption stay native selects (WPA2-Personal, AES), which
  this work deliberately leaves alone.
- **Drafts' list has no search and Snapshots' does.** That asymmetry is the
  spec's open question and is unchanged here: the Drafts Collection header offers
  only the *New Draft* field and button.
- **A Draft's Records are editable; a Snapshot's are not.** The Draft pane shows
  per-Record controls and an add-a-Record row; the Snapshot pane shows facts, a
  name and a note. Neither pane is ever a blank surface.

## Correction: the plaintext notice is not on this page

The previous version of this report said the plaintext notice — "The library is
local plaintext JSON on this machine. It is never synced, uploaded, or sent
anywhere." — was "stated once on the page rather than per item". It is not on the
Library page at all. The Library page's own sentence is "Everything you have kept
— Snapshots of every read, and the Drafts you are composing — usable with no
Reader attached.", and the plaintext notice lives in **Settings → Data**, under
*Library file*, where the path is (`settings-data-980.png`,
`settings-data-900.png` in [05-settings-and-tools.md](05-settings-and-tools.md)).
Checked by reading the rendered text of both surfaces in this pass.

## Heights, re-measured at this branch's width

The shell's 24px inset and the removed 768px column changed every one of these
numbers, so they are restated rather than carried over:

| Surface | Content | Viewport at 980×760 | Content | Viewport at 900×700 |
|---|---|---|---|---|
| Library, Snapshots, an item open | 767 px | 724 px | 786 px | 664 px |
| Library, Drafts, an item open | 938 px | 724 px | 994 px | 664 px |

- The **Drafts pane is still the tallest surface in the app**: 994 px of content in
  a 664 px viewport at the minimum size (previously reported as 1002 px), so the
  second Record and the write block need a scroll. Expected for an editor, and
  recorded rather than fixed.
- The **Snapshot detail pushes 122 px past the fold at 900×700** (previously
  reported as 130 px): the overflow is the write-back block, whose own *Write to
  tag* button sits at y = 764…798 in a 700 px window. At 980×760 the same pane
  overflows by 43 px.

## Findings raised by this area

None of its own. The two cross-area observations above are recorded in
[08-findings.md](08-findings.md).

## What is *not* established here

- That 500 Snapshots stay interactive: the fixture holds two. That criterion is
  covered by the library store's own tests, not by a screenshot.
- Anything about a real library file on disk. The fixture answers from memory, and
  the path in Settings → Data (`/Users/someone/Library/Application Support/pm4-studio/library.json`)
  is the fixture's own string, not this machine's.
