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
- Ticket 01 is a prefactor: it changes no shipped behaviour, and it exists so that four
  following tickets can prove what they ship.
