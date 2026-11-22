# 04 — Library: both collections, with and without a selection

**Ticket criterion:** Library in both collections, with nothing selected and with
an item open in the detail pane, at both sizes.

**What the screenshot shows:** the library is read through the Rust store, which
is not running here, so the fixture answers `library_load` and `drafts_load` with
two Snapshots and two Drafts. The layout, the selection behaviour and the editor
are the app's.

| State | 980×760 | 900×700 |
|---|---|---|
| Snapshots, an item open | `library-snapshots-selected-980.png` | `library-snapshots-selected-900.png` |
| Snapshots, nothing selected | `library-snapshots-none-980.png` | `library-snapshots-none-900.png` |
| Drafts, an item open | `library-drafts-selected-980.png` | `library-drafts-selected-900.png` |
| Drafts, nothing selected | `library-drafts-none-980.png` | `library-drafts-none-900.png` |

## What holds

- **Two panes, list beside detail, at both sizes.** Selecting an item fills the
  right pane; selecting the open item again empties it into the explicit
  *Nothing selected* state ("Choose a Snapshot from the list to rename it, add a
  note, or write it back to a tag") — never a blank pane.
- **Two collections, one page.** A collection switch at the top; Snapshots holds
  the keep-forever reads, Drafts holds the editable messages. Drafts is not a
  destination in the sidebar.
- **A Draft's Records editor sits beside the list**, never below an unrelated
  panel: name, delete, then the Records in order with per-Record move and delete,
  then the add-a-Record row.
- **A Snapshot is renamed and noted in place**, with Save/Revert enabled only when
  something changed, and Delete behind its own confirmation.
- **The plaintext notice is where the file is:** "The library is local plaintext
  JSON on this machine. It is never synced, uploaded, or sent anywhere" — stated
  once on the page rather than per item.

## Findings raised by this area

None of its own. Two cross-area observations apply and are recorded in
[08-findings.md](08-findings.md):

- the Drafts pane is the tallest surface in the app (1002 px of content in a 664 px
  viewport at 900×700), so editing the second Record needs a scroll — expected for
  an editor, recorded for the record rather than as a defect;
- the Snapshot detail pushes 130 px past the fold at 900×700, which is the
  write-back block rather than the thing being edited.

## What is *not* established here

- That 500 Snapshots stay interactive: the fixture holds two. That criterion is
  covered by the library store's own tests, not by a screenshot.
- Anything about a real library file on disk. The fixture answers from memory.
