# The Erase confirmation is taller than the window

**What to build:** The 13.56 MHz Erase confirmation is eight paragraphs long, and its own buttons fall outside the window at both sizes the redesign is verified at. Confirming an erase therefore means scrolling to find the button first. It is also the clearest surviving instance of the "too much text" complaint the redesign was commissioned to answer: seven explanatory paragraphs for one destructive action whose whole outcome is a single sentence.

Measured during ticket 20's verification:

| Viewport | Content column needs | Viewport has | The buttons |
|---|---|---|---|
| 900×700 | 799 px | 664 px | off screen |
| 980×760 | 799 px | 724 px | bottom edge at y=777 |

Nothing else in the app puts its own action buttons into the overflow: every other confirmation fits, with the longest of them (Reset) ending at 863 px of content whose buttons are the last thing on screen.

**Blocked by:** None. Evidence: `docs/superpowers/e2e/08-findings.md` (finding F3), `docs/superpowers/e2e/03-13-56-mhz.md`, and `screenshots/hf-erase-confirmation-900.png`.

**Seams:**
- Visual gate (existing) — catches a confirmation whose action buttons are not in the viewport at 900×700; misses whether the copy is worth reading.
- Confirmation gates (existing) — catches the pair of proofs (dismissing leaves the target intact, confirming acts); says nothing about whether the user can find either button.

**Tracker:** None

**Status:** ready

- [ ] The confirmation's own buttons are inside the content viewport at 900×700, with the copy that remains above them.
- [ ] The copy says what the erase destroys, that the tag stays a tag, and that only the message area is written — and nothing else. The paragraphs that restate the same point (that an erased tag is still a tag, that pages 0–3 are untouched, that locking is not possible, that password protection is not removed) are candidates for one sentence each or for the capability limits, which already state the locking and password facts once.
- [ ] Every fact the current copy carries that is not stated anywhere else in the app stays somewhere: the check is that removing a paragraph does not remove a fact the user needs before consenting.
- [ ] The copy is judged against the spec's "too much text" complaint, not merely shortened until it fits.
- [ ] A gate catches the class rather than this instance: either the visual sweep asserts that every confirmation's action row is within the viewport at 900×700, or the reason it cannot is recorded in the sweep's own report.
