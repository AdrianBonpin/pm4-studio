# Clearing a tag must leave it usable; destroying it must be its own action

**What to build:** Two different actions where there is one today. **Clear** gives a
tag no usable identity and leaves it a live, rewritable chip. **Destroy** is the
current all-zero write, kept for tags you genuinely want gone, behind its own
harder gate and described for what it does.

**Cause, measured on hardware 2026-11-22.** The current Reset writes the neutral
Identity — customer `0x00`, data32 `0x00000000`. On a factory T5577 that write
lands (the tag stops presenting an identity, which is why the app reports *Blanked*)
and then the chip **locks**: it still latches and modulates, so every reader sees
it, but it refuses all further data. Two `0x0073` writes, one of them after lifting
the tag off the Reader and re-presenting it to force a re-latch, were both
acknowledged by the device and both ignored by the chip.

So Reset does not clear a tag, it consumes one, and leaves an object that looks
alive to every reader it meets. `docs/PROTOCOL.md` warned that "a bogus payload can
lock the chip"; this is the same failure with the payload the app ships.

**Why not just keep zeroes and warn.** Because the two things a person wants are
genuinely different, and one of them is routine. "This fob should stop opening the
door, and I want the tag back" is the everyday case; "this fob must never open
anything again" is rare and destructive. One operation cannot be both, and the
current one is the rare destructive one presented as the routine one.

**The cleared value must not be zero.** Zero is the value that locks the chip, so
the cleared state is a **non-zero placeholder identity** — the tag keeps an Identity,
the chip keeps working, and no system issued that number. The value must be chosen
with the collision reasoning written down: a cleared tag is still a token, and the
placeholder must be one a building system will reject rather than one that might
match a real fob.

**Blocked by:** the presence-aware write guard (a cleared tag must remain a legal
write position, or Clear leaves a tag that cannot be reprogrammed). That fix is in
flight; this ticket lands after it.

**Seams:** Write outcome classification (the result of each action, and what it may
claim); the Identity codec (the placeholder value and its encoding); confirmation
gates (Destroy needs a gate Clear does not). The classification catches an action
reported as the other, or a claim of recoverability that was never observed; it
misses whether a particular chip actually accepts the next write, which only
hardware settles.

**Tracker:** None
**Status:** ready

- [ ] **Clear** writes a non-zero placeholder Identity and reports what the tag now
      carries, in words that make clear it is not a working fob.
- [ ] A cleared tag can be written again from inside the app — clone onto it, and
      author an Identity onto it — with no read-before-write refusal, and the
      write subscribes to the same confirmation and read-back as any other.
- [ ] The placeholder value is recorded in one place with the reason it was chosen,
      including why it is not zero and why it is not a small round number.
- [ ] **Destroy** is a separate action, is not the default, and its confirmation
      states plainly that it permanently disables the tag — not that it "may refuse
      further writes".
- [ ] Destroy reports the outcome it actually produced, and never claims the tag can
      be recovered or reused.
- [ ] Both actions are distinguishable in the outcome vocabulary, in the audible
      symbol and in the message, and a test proves neither can be reported as the
      other.
- [ ] `GLOSSARY.md` is corrected: **Reset** currently means "overwrite a Tag's
      Identity with nothing", which is the operation that destroys. The term is
      either retired in favour of Clear and Destroy or redefined to name which one
      it is, and no user-facing string still says "Reset" for the destructive one.
- [ ] `docs/PROTOCOL.md`'s blanking section records the measurement: writing
      data32 = 0 on a T5577 leaves it readable with no identity and permanently
      refusing data, observed twice with a re-seat between.
- [ ] Verified on hardware: a factory tag is Cleared, then written again from the
      app and reads back as the new Identity; and on a separate expendable tag,
      Destroy leaves it visible to the Reader with no Identity and refusing writes.
