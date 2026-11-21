# Studio Redesign

**Spec:** docs/superpowers/specs/2026-11-22-studio-redesign.md
**Baseline:** aff5eff10d74a7545a37207fa55133818adde1fb
**Branch:** feat/studio-redesign
**Spec issue:** https://github.com/AdrianBonpin/pm4-studio/issues/10

Destination: PM4 Studio reports every operation through one outcome seam that
drives both a message and an audible signal, arranges its five destinations in
the order the work happens, and stops claiming knowledge it does not have — a
measured 13.56 MHz decode, an honest Reset, and no writability probe. The only
capability additions are Copy on 13.56 MHz and savable 13.56 MHz reads.

## Graph

| Ticket | Blocked by | Delivers |
|---|---|---|
| 01 Vendor impeccable and write the agent-facing artifacts | None | A design-rule check anyone can run, and a repository that states the design vocabulary is binding |
| 02 Report every operation through one outcome seam, shown as a toast | None | Operations that end say so on screen, in a corner you choose, for as long as the severity warrants |
| 03 Five destinations, a Settings page, and a slimmer Tools | 02 | 125 kHz · 13.56 MHz · Library · Tools · Settings, with preferences, version, credits and limits in one place |
| 04 Sound the four-symbol alphabet with a three-way quiet level | 02, 03 | Failure and success are different sounds for the first time, and silence means nothing happened |
| 05 Settings → Data: library path, export/import, and clear all saved data | 03 | The library file is findable, backable-up, and clearable in one deliberate action |
| 06 Decode the measured reply layout, and stop claiming unresolved families | None | A tag reads as the family it actually is, including 7-byte and 10-byte UIDs |
| 07 Library becomes a two-pane list-and-detail for Snapshots | 03 | Choosing a Snapshot shows it beside the list instead of pushing it down the page |
| 08 One Read on 13.56 MHz fetches the identity and the message | 06 | One tap answers what the tag is and what it holds |
| 09 Save a 13.56 MHz read as a Snapshot with its Records; schema v3 | 07, 08 | A 13.56 MHz read is as durable as a 125 kHz one, and the file says version 3 |
| 10 Drafts becomes a collection inside Library | 07, 08 | Records are edited beside the list, never below an unrelated panel |
| 11 125 kHz becomes a mode-switched workspace | 02, 03 | Read · Write · Reset · Clone · Batch in the order the work happens, one at a time |
| 12 Reset tells the truth; a refused Reset is its own outcome | 04, 11 | A tag that will not accept writes is reported as such, with the cause named |
| 13 Clone and Batch report their own outcomes | 04, 11 | Every clone attempt, including the ones that fail, is heard and seen |
| 14 13.56 MHz becomes a mode-switched workspace | 03, 08 | Operations before troubleshooting, and the panel that could never work is gone |
| 15 Copy a whole NDEF message between 13.56 MHz tags | 08, 14 | Duplicating a message is one guided flow with the source protected |
| 16 Edit as Draft from a 13.56 MHz readout | 08, 10 | Editing what is on a tag no longer requires visiting another page first |
| 17 Contract: remove the legacy chirp prop | 13, 15, 16 | No component can reach the beeper except through the outcome seam |
| 18 Replace the left-bar notice treatment app-wide | 10, 11, 12, 13, 14, 15, 16, 17 | No message is announced only by a coloured bar down one side of a box |
| 19 Make the design check blocking and clear the remainder | 18 | The patterns removed here cannot quietly return |
| 20 Verify the redesign visually and on hardware | 19 | The redesign is seen at both window sizes and exercised on both tag families |

**Initial frontier:** 01, 02, 06

## Why these edges

- **02 → 03, 02 → 04.** The Settings page has a toast-corner control and a quiet
  level control; both are controls over the two channels the outcome seam owns.
  Building the page first would mean building controls with nothing behind them.
- **01 is independent** of the product work. It is a tooling slice whose output is
  a check anyone can run, and it gates nothing until 19 turns it into a wall.
- **06 is independent**, which is why it is on the frontier. It is a pure decode
  change plus two captured fixtures, and it unblocks both remaining 13.56 MHz
  slices without needing any of the shell work.
- **03 → 07, 03 → 11, 03 → 14.** Every page restructure assumes the destination
  set and the Settings page it hangs off.
- **07, 08 → 09, 07, 08 → 10.** Saving a 13.56 MHz read needs the detail pane to
  show it in and the read action to produce it. The Drafts collection needs the
  same two-pane shape.
- **08 → 14, 08 → 15, 08 → 16.** Copy, Edit-as-Draft and the 13.56 MHz workspace
  all consume the one-action Read. Without it each would grow its own reading path.
- **04, 11 → 12, 04, 11 → 13.** Reset's refusal and Clone's failures are new
  outcomes, so they need the alphabet and the mode they are reported in.
- **13, 15, 16 → 17.** The chirp prop can only be deleted once every page that
  handed it out has been rewired.
- **10–17 → 18.** The notice sweep must see the finished interface. Sweeping first
  would rewrite what the page tickets then rewrite again.
- **18 → 19, 19 → 20.** A blocking gate is only honest once the violations are
  cleared, and verification measures the gated tree.

## Scope notes

- Every ticket carries one end-to-end behaviour. Nothing here is a layer.
- Decision 03 also moves Drafts inside Library so that reducing the sidebar to five
  destinations cannot orphan it. That is a scope clarification of an approved
  ticket, not a new one.
- The two 13.56 MHz captures recorded in the spec are the first real poll fixtures
  in the repository; every existing 13.56 MHz fixture is synthetic.
- Deferred structural debt from `docs/tickets/tag-studio-defects/`: the DraftsPage
  reduction closes here, because the page dissolves into the Library two-pane. The
  `library.rs` split stays declined for the reason already recorded.
