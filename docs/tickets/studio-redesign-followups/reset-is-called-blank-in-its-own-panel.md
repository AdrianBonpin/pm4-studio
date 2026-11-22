# Reset is called "Blank" in its own panel

**What to build:** The 125 kHz operation is named **Reset** in the segmented control, in `GLOSSARY.md` and in the ticket that made it honest. Its own panel calls it something else: the heading is *Blank a tag*, the first control is *Read the tag to blank*, the confirm button is *Blank this tag permanently*, the follow-up button is *Blank another tag*, and the page subtitle ends "…or blank a tag". `GLOSSARY.md` puts "blank (as a verb)" on Reset's *Avoid* line for the reason the spec gives: the word invites the factory-restore reading the redesign set out to end, and the panel's own first sentence then has to spend a line denying it ("Blanking is not a factory reset and it does not unlock the tag").

**Blocked by:** None. Evidence: `docs/superpowers/e2e/02-125-khz.md` (finding F4) and `screenshots/lf-reset-confirmation-980.png`.

**Seams:**
- Vocabulary guard (existing, `src/lib/…` copy tests) — catches a mode whose name and copy disagree; it is the seam that already protects the other terms, and this pair was simply never covered.
- Reader capability limits (existing) — the words for what Reset cannot do (no factory restore, no unlock) are stated there once, which is where the denial currently duplicated in the panel belongs.

**Tracker:** None

**Status:** done — **superseded on naming** by
[`clearing-a-tag-must-leave-it-usable.md`](clearing-a-tag-must-leave-it-usable.md)

> **Amendment (2026-11-22).** This ticket made the panel say **Reset**, which was
> the right fix for the defect it found: one name for one operation. The Clear/
> Destroy split then retired that name — a destructive operation a user reaches for
> by habit should not be called something that sounds like "start over" — so the
> mode, the panel and every string now say **Clear**, and **Destroy** is a separate
> control inside it. The *structure* this ticket built survives unchanged: the mode
> pill's label and the panel's words still come from one name, and
> `lib/clearTag.test.ts` → "the mode and its panel say the same word" still fails if
> they part company. Every criterion below is still met; only the word changed.

- [x] The panel heading, its controls and its outcome words say **Reset**, and the verb "blank" as an action the user performs is gone from the 125 kHz page's copy. "Blank" as a *noun* stays, in Clone and Batch. — `lib/blankTag`: `RESET_PANEL_TITLE` "Reset a tag", `RESET_READ_CONTROL` "Read the tag to reset", `RESET_ACTION_LABEL` "Reset this tag permanently", `RESET_ANOTHER_CONTROL` "Reset another tag", and `resetNotice` words the outcome "Reset — the tag no longer presents an Identity" / "Not reset: …".
- [x] The page subtitle no longer ends "…or blank a tag". — `lib/pageCopy.ts`: "…author one by hand, or Reset a tag."
- [x] The outcome that a successful Reset produces is still worded as *blanked* on the wire (`BlankResult.outcome`) — this is interface copy, not the wire vocabulary. — unchanged: `BlankResult`, `lf_blank` and `src-tauri/src/blank.rs` are untouched, and `reporting.test.tsx` still asserts `kind: "blanked"`.
- [x] The sentence denying a factory restore is not deleted, only moved or shortened: whether Reset can restore or unlock is stated once, in Settings → Diagnostics → Capability limits. — the panel's paragraph is gone; `READER_CAPABILITY_LIMITS`' *Factory restore and unlock* entry carries the fact ("Not possible. … cannot be recovered"), and `lib/blankTag.test.ts` → "leaves the factory-restore denial where the limits are stated once" fails if that entry loses it.
- [x] A test asserts the mode's name and its panel's words agree. — `lib/blankTag.test.ts` → "the mode and its panel say the same word": the pill's label comes from `lib/lfModes`, and `RESET_PANEL_TITLE`, `RESET_ACTION_LABEL`, `RESET_ANOTHER_CONTROL`, the confirmation's title and `RESET_READ_CONTROL` must all carry it, plus "never uses 'blank' as the verb for what the user does" over the panel's whole copy.
