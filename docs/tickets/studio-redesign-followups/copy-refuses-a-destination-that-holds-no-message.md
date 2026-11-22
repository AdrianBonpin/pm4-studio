# Copy refuses a destination that holds no message

**What to build:** Copy refuses a destination tag it can read perfectly well but which holds no NDEF message — a formatted tag with an empty NDEF TLV, or a tag that is not NDEF formatted at all. It reports *"Not copied: the destination's message could not be read, so nothing is replaced"* and quotes the tag's own "it holds a message of zero bytes" sentence underneath as though that were a read failure. An empty tag is the ordinary destination for a copy: the flow exists to put a message on a second tag, and the second tag usually has nothing on it. As built, Copy only works when the destination already carries an NDEF message.

**Cause:** `copyDestination` in `src/lib/hfCopy.ts` sets `message` only when the read came back as `state === "records"`, so "read fine, holds nothing" and "could not be read" collapse into the same value, and `destinationDecision` refuses both as `destination-unreadable`. The existing tests cover an unreadable destination and a destination that already holds the message; none covers a destination that is readable and empty.

**Blocked by:** None. The refusal was reproduced live in the browser during ticket 20's verification; see `docs/superpowers/e2e/08-findings.md` (finding F2) and `docs/superpowers/e2e/03-13-56-mhz.md`.

**Seams:**
- Copy guard (existing, pure, `src/lib/hfCopy.ts`) — catches "holds nothing" being treated as "unreadable"; misses whether a chip-level lock or password is what made a write fail, which only hardware settles.
- HF read (existing) — the read half already distinguishes `empty`, `missing`, `notFormatted` and `unreadable`; the guard is what loses the distinction.

**Tracker:** None

**Status:** ready

- [ ] A destination that is readable and holds no Records is a **proceed**, not a refusal: the confirmation says there is nothing to replace instead of naming a message, and the copy runs.
- [ ] *Could not be read* stays a refusal, worded as it is now, for a tag whose memory or poll reply genuinely failed. The two conditions are distinguishable in the value the guard receives, not by matching the sentence.
- [ ] An unformatted destination is handled by whichever rule the slice lands on — refuse with "this tag is not NDEF formatted, so it cannot take a message" (if formatting is out of scope) or proceed as empty — and the choice is stated in the pull request rather than left implicit. Refusing it as *unreadable* is not an acceptable answer either way.
- [ ] The destination's capacity is still weighed, so "empty and too small" refuses for the size and not for the emptiness.
- [ ] A test asserts, through the guard, that a destination read as `empty` or `notFormatted` reaches the confirmation, and that one read as `unreadable` does not.
- [ ] No message is written before the confirmation, and the source-removal step is unchanged: this is a value the guard was already handed, not a new path into the write.
