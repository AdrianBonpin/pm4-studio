# Copy refuses a destination that holds no message

**What to build:** Copy refuses a destination tag it can read perfectly well but which holds no NDEF message — a formatted tag with an empty NDEF TLV, or a tag that is not NDEF formatted at all. It reports *"Not copied: the destination's message could not be read, so nothing is replaced"* and quotes the tag's own "it holds a message of zero bytes" sentence underneath as though that were a read failure. An empty tag is the ordinary destination for a copy: the flow exists to put a message on a second tag, and the second tag usually has nothing on it. As built, Copy only works when the destination already carries an NDEF message.

**Cause:** `copyDestination` in `src/lib/hfCopy.ts` sets `message` only when the read came back as `state === "records"`, so "read fine, holds nothing" and "could not be read" collapse into the same value, and `destinationDecision` refuses both as `destination-unreadable`. The existing tests cover an unreadable destination and a destination that already holds the message; none covers a destination that is readable and empty.

**Blocked by:** None. The refusal was reproduced live in the browser during ticket 20's verification; see `docs/superpowers/e2e/08-findings.md` (finding F2) and `docs/superpowers/e2e/03-13-56-mhz.md`.

**Seams:**
- Copy guard (existing, pure, `src/lib/hfCopy.ts`) — catches "holds nothing" being treated as "unreadable"; misses whether a chip-level lock or password is what made a write fail, which only hardware settles.
- HF read (existing) — the read half already distinguishes `empty`, `missing`, `notFormatted` and `unreadable`; the guard is what loses the distinction.

**Tracker:** None

**Status:** done

- [x] A destination that is readable and holds no Records is a **proceed**, not a refusal: the confirmation says there is nothing to replace instead of naming a message, and the copy runs. — `src/lib/hfCopy.ts`, `copyDestination`: `holds` carries `empty` separately from `unreadable`, and `copyDecision` proceeds on it. `hfCopy.test.ts` → "takes 'holds nothing' from the read model rather than calling an empty Tag unreadable" and "asks for the acknowledgement on an empty destination whose capacity is unknown, and proceeds once it has it".
- [x] *Could not be read* stays a refusal, worded as it is now, for a tag whose memory or poll reply genuinely failed. The two conditions are distinguishable in the value the guard receives, not by matching the sentence. — `refusal.condition` is `destination-unreadable` for that read, and the messages differ; `hfCopy.test.ts` → "refuses a destination whose message could not be read, quoting the reason".
- [x] An unformatted destination is handled by whichever rule the slice lands on, and the choice is stated rather than left implicit. **The rule that landed: refuse it, named as formatting.** `copyDecision` refuses with `condition: "destination-not-formatted"` and *"Not copied: this tag is not NDEF formatted, so it cannot take a message"* — formatting is out of scope for this build, and it is not refused as unreadable. Stated here because the sentence that had to carry it was a pull-request note on a branch that has since been integrated (`73b385e`'s predecessor), and this file is where the next reader looks.
- [x] The destination's capacity is still weighed, so "empty and too small" refuses for the size and not for the emptiness. — `hfCopy.test.ts` → "refuses an empty destination that is too small for the size, not for the emptiness".
- [x] A test asserts, through the guard, that a destination read as `empty` or `notFormatted` reaches the confirmation, and that one read as `unreadable` does not. — `hfCopy.test.ts` → "takes a Tag with no NDEF TLV as holds-nothing too, not as a failed read" and "keeps a Tag that is not NDEF formatted a distinct refusal, and a failed read a refusal", which asserts both `refusal.condition` values.
- [x] No message is written before the confirmation, and the source-removal step is unchanged. — the guard still decides from values it is handed; nothing in `copyDestination` writes, and the source-removal tests ("the source-removal guard") are untouched.

**Closed by:** a fresh review's Standards/Spec pass on the integration SHA, which found the fix shipped with its tests.
