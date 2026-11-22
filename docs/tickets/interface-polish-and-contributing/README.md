# Interface polish and a contribution guide

**Spec:** docs/superpowers/specs/2026-11-22-interface-polish-and-contributing.md
**Baseline:** fc0d763c48b17058daf97595777380105e97611c
**Branch:** feat/interface-polish-and-contributing
**Spec issue:** https://github.com/AdrianBonpin/pm4-studio/issues/32

The spec is the destination; these tickets are the route. It holds two independent
workstreams — the interface polish (01–08) and a contribution guide (09) — that share
no files and no seams, and were approved as one document.

## Graph

| Ticket | Blocked by | Delivers |
|---|---|---|
| 01 · The hand-rolled chip rows become the switcher and buttons | — | The Identity pair is the switcher and the console presets are buttons, so the shape changes once rather than three times |
| 02 · The shape vocabulary: switcher 4px, buttons 6px, one pill | 01 | Every switcher is a cornered chip on one line, every button a 6px rectangle, the Toggle the only pill; `DESIGN.md` describes it |
| 03 · Pages use the width they have | — | Section rules reach both edges at a 24px text inset, the letterbox is gone, measurements keep a readable measure |
| 04 · A gate for a class that names a colour which does not exist | — | The Destroy divider becomes visible, and the build fails on a border colour the palette does not define |
| 05 · Choose a Draft by its name or by what is inside it | — | Write mode lists the Drafts with a search field over name, id and authored Record values; nothing preselected; the choice opens the write panel |
| 06 · E2E — the shell and the 125 kHz page | 01, 02, 03, 04 | Both reports re-captured at 980×760 and 900×700, claims re-checked, retired words gone |
| 07 · E2E — 13.56 MHz, Library, Settings with Tools | 01, 02, 03, 04, 05 | The remaining destinations re-captured, including the Draft list where the dropdown used to be |
| 08 · E2E — the long-label sweep and the Draft list's flow | 01, 02, 03, 04, 05 | Nothing wraps at the minimum, every mode one click away, and a new report for using the Draft list |
| 09 · A contribution guide that states the convention | — | `CONTRIBUTING.md`: types, scopes, subjects, breaking changes, PR titles, the flow, and the honest absence of enforcement |

**Initial frontier:** 01, 03, 04, 05, 09.
