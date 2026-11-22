# The capability limits contradict the app

**What to build:** Settings → Diagnostics → Capability limits tells the user that this build cannot do two things it does. The *NDEF messages* entry says NDEF is "not readable or writable today" and that "the NTAG commands that carry NDEF have never answered on this Reader"; the *7- and 10-byte UIDs* entry says "only 4-byte UIDs are split out; a longer UID is shown as raw bytes". Since slices 06, 08 and 15 the build reads a tag's message and lists it as Records, writes a Draft to a tag, copies a whole message between two tags, erases one, and decodes a 7-byte UID without a raw fallback. Both entries predate the work that made them false, and 19's sweep could not catch them because it matches source patterns rather than checking whether a sentence is still true.

**Blocked by:** None. The evidence is in this branch: `docs/superpowers/e2e/05-settings-and-tools.md` and `docs/superpowers/e2e/08-findings.md` (finding F1), with `screenshots/settings-diagnostics-limits-980.png` beside `screenshots/hf-read-decoded-980.png`.

**Seams:**
- Reader capability limits (existing, `src/lib/readerIdentity.ts`) — catches an entry that contradicts a capability the app ships; misses nothing within its own scope, since the list is the only place these limits are stated.
- The reader readout (existing) — catches the decoder refusing a width the limits claim is refused; the two must be read together, which is what makes one test over both of them possible.

**Tracker:** None

**Status:** ready

- [ ] The *NDEF messages* entry describes NDEF as available, naming what is read and written and what remains unavailable: the message and its Records are read and written through the Type 2 TLV; password protection, APDU passthrough and MIFARE Classic sectors stay listed as unavailable in their own entries.
- [ ] The *7- and 10-byte UIDs* entry no longer claims a longer UID is raw. It states that 4-, 7- and 10-byte widths are decoded from the reply's own length byte, and that a 10-byte width has a decoder but no hardware confirmation until a 10-byte tag is tried — the spec's open question, stated as an open question rather than as a limit.
- [ ] No entry claims a capability is absent while a page in the same build offers it.
- [ ] A test fails if a limit's claim disagrees with the surface that implements it: the narrow version is a test over the limits list asserting the exact entries that must not exist (a "not readable or writable" NDEF claim, a "raw" claim for 7- and 10-byte UIDs), so the words cannot come back by accident.
- [ ] Nothing else in the list changes: MIFARE Classic sectors, APDU passthrough, password protection, factory restore and 125 kHz writability stay as they are, because each is still true.
