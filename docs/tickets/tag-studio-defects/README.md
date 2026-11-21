# Tag Studio Defects

**Spec:** docs/superpowers/specs/2026-11-21-full-tag-studio.md
**Spec section:** Post-Implementation Defects (2026-11-22)
**Baseline:** 24c59955d2d6fdac5901c9e34d71897905d5620f
**Branch:** feat/tag-studio
**Spec issue:** https://github.com/AdrianBonpin/pm4-studio/issues/3

## Graph

| Ticket | Blocked by | Delivers |
|---|---|---|
| 01 Prove destructive confirmations by driving the interface | None | The eight destructive gates are proven by clicking, so removing a confirmation fails a test |
| 02 Keep a queued Draft edit through window close | 01 | Type, quit instantly, relaunch, find the edit; a failed final save asks before closing |
| 03 One serialisation domain for the library file | None | Overlapping saves queue and both land instead of last-rename-wins |
| 04 Bump the schema version and migrate v1 on open | 03 | A v1 file becomes v2 intact; an older build refuses a v2 file rather than stripping Drafts |
| 05 Restrict the raw console to commands that cannot alter a tag | 01 | Release refuses writes and anything unlisted; debug builds keep full range |
| 06 Confirm a Draft delete before removing it | 01 | Draft delete stops being a one-click loss; the eighth gate gets its dismiss proof |

**Initial frontier:** `01`, `03`

## Why these edges

- **01 → 02, 01 → 05.** Without the harness, tickets 02 and 05 would each hand-roll a
  way to prove their own confirmation, duplicating the prefactor rather than using it —
  and the gates in question are exactly the ones story 61 was written about.
- **03 → 04.** The migration adds a write path to the library file. Landing it before
  the locks are consolidated would give it a third serialisation domain to either join
  or bypass.

## Scope notes

- These tickets fix defects against requirements already stated in the spec. They add
  no capability, and the spec's own "Deliberately not addressed" list stays unticketed.
- Stories 57–61 map to tickets 02, 03, 04, 05 and 01 respectively.

## Correction (2026-11-22)

Spec D5 claims eight destructive gates are unproven. There are seven: **Draft delete has
no confirmation at all** — its trash control removes a Draft on the first click. Ticket
01 therefore proves seven gates, and ticket 06 adds the missing confirmation so that
D5's count becomes true. This is the only ticket added after the breakdown was approved,
and it was added on explicit user direction rather than by an implementer deciding to
widen scope.
- Ticket 01 is a prefactor: it changes no shipped behaviour, and it exists so that four
  following tickets can prove what they ship.

## Deferred at review

Two structural observations from the review of these tickets. Neither has a user
impact, neither belongs to a defect these tickets fix, and each is better as its own
ticket than as scope added here.

- **Splitting `src-tauri/src/library.rs`.** 2513 lines at the commit that recorded
  this (`4e3c20e`); 2328 is what it was at the review baseline it was first
  measured at (`e9ef17f`), and it grew between the two as tickets landed. The
  serialisation domain — `Domain`, `serialised`, `write_atomically` — and the
  atomic-write rules are separable from the store that uses them, and the
  `Library` value type is separable from the store as well. The file is cohesive
  today and the split is a move, not a redesign; doing it here would have put a
  large mechanical diff underneath the behaviour fixes and made both harder to
  review.
- **Any further reduction of `src/pages/DraftsPage.tsx`.** The two extractions this
  review asked for (the row delete confirmation and the migration warning) took the
  duplicated markup out, and the queue and close guard moved above the page. What is
  left is one page's form for one collection, still long. Splitting it further means
  deciding what its parts are called, which is a design question about the Drafts page
  rather than a fix for a defect.
