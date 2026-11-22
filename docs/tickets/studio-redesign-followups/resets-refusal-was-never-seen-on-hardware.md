# Reset's refusal was never seen, and a blanked tag may stop answering

**What to build:** Evidence that the "this tag will not accept writes" outcome
happens on real hardware, and a decision about what the app should say when a
blanked tag stops answering entirely instead of refusing a write.

**Cause.** Ticket 12's whole point is a second Reset producing its own outcome —
three chirps, the LED held on, "the tag will not accept writes", with the likely
cause named. The 2026-11-22 hardware run never reached it. Blanking succeeded and
was reported honestly as *Blanked* with no copy counted, but the tag then refused
to be **read** as well as written, so there was no tag left to attempt the second
Reset against. The app's own words at that point are "It will probably read as
empty now, showing no Identity at all" — which is not what was observed.

Two things are therefore unknown, and they need separating:

1. Whether the refusal outcome fires at all on hardware. It is proved in the
   automated suite, which is evidence about the classifier, not about a tag.
2. Whether the blanking write can leave a tag unreadable. That would be worse than
   the caveat the app prints, because the caveat promises the tag still reads back
   the Identity it carries and may refuse further writes — a tag that goes silent
   is neither.

The second may be ordinary T5577 behaviour for an already-written chip rather than
a defect in the payload this app sends. That has to be settled by a measurement,
not by reasoning: the write payload and the tag's datasheet decide it.

**Blocked by:** None

**Seams:** Write outcome classification (extended), and the blanking payload. The
classifier catches a refusal reported as failure or as unverified; it misses the
difference between "the chip refused" and "the chip stopped modulating", which only
a second tag and a known-good payload settle.

**Tracker:** None
**Status:** ready

- [ ] A fresh, never-written T5577 is blanked, then blanked again: the second
      attempt reports *will not accept writes*, plays three chirps, holds the LED
      for two seconds, and counts no copy.
- [ ] The same tag is read after the first blank, and its readout is compared with
      what the app promised ("shows no Identity"). If it does not read, the app's
      sentence is wrong and is corrected to what happens.
- [ ] A blanked tag that stops answering produces its own distinguishable report —
      not "the reader is absent", and not a generic failure attributed to the
      cable.
- [ ] The blanking payload is checked against the tag family's datasheet, and the
      outcome is written down: either the payload is wrong, or becoming unreadable
      is what blanking this chip does and the caveat says so.
- [ ] Whichever way it resolves, `docs/superpowers/hardware-checklist-studio-redesign.md`
      item 5 is re-run and its result recorded, so the claim stops resting on the
      automated suite alone.
