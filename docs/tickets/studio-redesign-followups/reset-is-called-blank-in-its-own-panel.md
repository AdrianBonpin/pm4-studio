# Reset is called "Blank" in its own panel

**What to build:** The 125 kHz operation is named **Reset** in the segmented control, in `GLOSSARY.md` and in the ticket that made it honest. Its own panel calls it something else: the heading is *Blank a tag*, the first control is *Read the tag to blank*, the confirm button is *Blank this tag permanently*, the follow-up button is *Blank another tag*, and the page subtitle ends "…or blank a tag". `GLOSSARY.md` puts "blank (as a verb)" on Reset's *Avoid* line for the reason the spec gives: the word invites the factory-restore reading the redesign set out to end, and the panel's own first sentence then has to spend a line denying it ("Blanking is not a factory reset and it does not unlock the tag").

**Blocked by:** None. Evidence: `docs/superpowers/e2e/02-125-khz.md` (finding F4) and `screenshots/lf-reset-confirmation-980.png`.

**Seams:**
- Vocabulary guard (existing, `src/lib/…` copy tests) — catches a mode whose name and copy disagree; it is the seam that already protects the other terms, and this pair was simply never covered.
- Reader capability limits (existing) — the words for what Reset cannot do (no factory restore, no unlock) are stated there once, which is where the denial currently duplicated in the panel belongs.

**Tracker:** None

**Status:** ready

- [ ] The panel heading, its controls and its outcome words say **Reset**, and the verb "blank" as an action the user performs is gone from the 125 kHz page's copy. "Blank" as a *noun* — the Blank a Reset consumes, as the glossary defines it — stays: `Clone` and `Batch` write Identities onto Blanks and that word is correct there.
- [ ] The page subtitle no longer ends "…or blank a tag".
- [ ] The outcome that a successful Reset produces is still worded as *blanked* on the wire (`BlankResult.outcome`) — this is interface copy, not the wire vocabulary, and changing the wire value would break the library count rule for no gain.
- [ ] The sentence denying a factory restore is not deleted, only moved or shortened: whether Reset can restore or unlock is stated once, in Settings → Diagnostics → Capability limits, which already says it.
- [ ] A test asserts the mode's name and its panel's words agree, so the two cannot drift apart again.
