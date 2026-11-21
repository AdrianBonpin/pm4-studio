# 12: Reset tells the truth; a refused Reset is its own outcome

**What to build:** Reset stops reporting a consequence as though it were a surprise. Before the write it says plainly that this Reader cannot tell whether a tag will accept a write, that a tag already written once may refuse forever, and that the attempt is safe only on a tag you can afford to lose. When the tag refuses, the app says the tag will not accept writes and names the likely cause.

**Blocked by:** 04, 11

**Seams:**
- Write outcome classification (extended) — catches a refusal reported as a generic failure, as unverified, or as blanked; misses why the chip refused.
- Signal vocabulary (existing) — catches the refusal not reaching the attention symbol; misses whether the buzzer sounded.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/23
**Status:** ready

- [ ] The confirmation states the three caveats before the write, in plain words, not as a footnote.
- [ ] A re-read that still finds an Identity produces its own outcome — the tag will not accept writes — separate from a generic failure and separate from unverified.
- [ ] That outcome's message names the likely cause: the chip has already been written, or was never writable.
- [ ] That outcome emits the attention symbol, including the LED held on for two seconds.
- [ ] No outcome of this operation ever counts a confirmed copy.
- [ ] The capability limits record, once, that 125 kHz writability cannot be determined without attempting a write, so its absence reads as a documented limit.
- [ ] No writability probe exists anywhere in the app, including one hidden behind an acknowledgement or on a diagnostics surface.
- [ ] A never-written tag still resets successfully, and its success is reported as blanked rather than verified.
- [ ] Nothing in the interface invites a pre-check, because none exists.
