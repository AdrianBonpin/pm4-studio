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

**Status:** done

- [x] The confirmation's own buttons are inside the content viewport at 900×700, with the copy that remains above them. — measured with the dev fixture at 900×700: the confirm button's box is y=644–678 and the panel ends at 687 in a 700 px window. It was 743–777.
- [x] The copy says what the erase destroys, that the tag stays a tag, and that only the message area is written — and nothing else. — five blocks: the sentence naming the Records that go, `eraseWhere` (pages, bytes, and "Pages 0 to 3 … are never written"), two facts (*The content is gone*, *The tag stays a tag*), and one paragraph of two limit sentences.
- [x] Every fact the current copy carries that is not stated anywhere else in the app stays somewhere. — the third fact restated the second's "pages 0 to 3" clause and is folded into `eraseWhere`; `password protection` and `locking` stay in the confirmation because the capability limits state them about the *Reader*, not about what this erase does to the tag in front of the user; the byte count moved from the mono summary line into `eraseWhere`, and *keep the tag on the Reader* moved into the action row.
- [x] The copy is judged against the spec's "too much text" complaint, not merely shortened until it fits. — eight explanatory blocks became five, and the two denial paragraphs became one sentence each in one paragraph; nothing was cut to a stub.
- [x] A gate catches the class rather than this instance. — recorded in `docs/superpowers/e2e/08-findings.md` (F3): jsdom has no layout, so the gate for "a confirmation's action row is in the viewport at 900×700" is the visual sweep, and the reason it cannot be a unit test is written there rather than implied.
