# 01: Vendor impeccable and write the agent-facing artifacts

**What to build:** Anyone who clones the repository can load the design skill and run a design-rule check over the interface, and the repository says in one place that the design vocabulary is binding rather than a preference. The check reports violations today; it becomes a wall much later, once the interface has been brought up to it.

**Blocked by:** None (can start immediately)

**Seams:**
- Design check — catches rule violations across the component sources deterministically; misses taste, and anything the rule set does not encode.
- Vocabulary guard — catches a retired word appearing in user-facing copy; misses the same word appearing only in code.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/11
**Status:** ready

- [ ] The vendor's skill tree is present in the repository with its licence and attribution intact.
- [ ] A repository-level agent instruction file names where the skill lives, says to load it for any interface work, and states the binding constraints — the incumbent design tokens above the vendor's defaults, no nested containers, no badges that carry no meaning, no copy that restates the obvious, no message announced only by a coloured side bar.
- [ ] The rule tree itself is not copied into that file; it is referenced, so the two cannot drift.
- [ ] The product-intent and design-contract documents the skill reads exist, describe this app rather than a generic one, and record the incumbent tokens as the committed world.
- [ ] A package script runs the detector over the component sources and reproduces identical output across two runs on unchanged input.
- [ ] The script exits non-zero and says so when the detector cannot run — engine absent, download failed, binary missing. A tool that is not there is never reported as a pass.
- [ ] The script is advisory at this stage: it reports violations without failing the ordinary build.
