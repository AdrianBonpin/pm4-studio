# 04: Sound the four-symbol alphabet with a three-way quiet level

**What to build:** Failure and success stop sounding the same. One chirp means done, two mean the result needs checking, three mean attention — nothing changed — with the LED held on so the message survives a loud room. Silence means there was nothing to act on. A three-way level replaces the on/off switch so "errors and warnings only" is a real daily setting.

**Blocked by:** 02, 03

**Seams:**
- Signal vocabulary (pure) — catches a wrong chirp count for an outcome, an alphabet regression, and interleaving of concurrent sequences; misses the real chirp duration and audibility, which only hardware settles.
- Outcome seam (existing) — catches an outcome that produces no signal and no message; misses whether the buzzer physically sounded.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/16
**Status:** ready

- [ ] Each outcome maps to exactly one symbol: one chirp for done, two for needs-you, three for attention, silence for nothing-happened.
- [ ] A poll that latched nothing is silent; a poll that latched a tag the decoder then rejected is needs-you. The two are never conflated.
- [ ] A read loop signals once, on the reading that completes it, not on every iteration.
- [ ] An attention signal holds the LED on for two seconds and then releases it.
- [ ] Signals play in order rather than overlapping; the queue holds eight and drops the oldest rather than blocking; identical adjacent outcomes coalesce.
- [ ] The gap between chirps is one named value, not a value repeated at each call site.
- [ ] A failure to emit a signal never changes the operation's outcome. A beep problem cannot turn a success into an error.
- [ ] The quiet level is three-way — off, errors and warnings only, all — persists across restarts, and is changeable with the Reader disconnected.
- [ ] The existing boolean beep preference migrates: on becomes all, off becomes off. The old key is not reused for the new shape.
- [ ] The beep test in Settings emits one chirp when the Reader is connected, and reports the failure honestly when it is not, without claiming a chirp was heard.
