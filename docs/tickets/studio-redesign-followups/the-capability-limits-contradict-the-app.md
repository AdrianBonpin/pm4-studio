# The capability limits contradict the app

**What to build:** Settings → Diagnostics → Capability limits tells the user that this build cannot do two things it does. The *NDEF messages* entry says NDEF is "not readable or writable today" and that "the NTAG commands that carry NDEF have never answered on this Reader"; the *7- and 10-byte UIDs* entry says "only 4-byte UIDs are split out; a longer UID is shown as raw bytes". Since slices 06, 08 and 15 the build reads a tag's message and lists it as Records, writes a Draft to a tag, copies a whole message between two tags, erases one, and decodes a 7-byte UID without a raw fallback. Both entries predate the work that made them false, and 19's sweep could not catch them because it matches source patterns rather than checking whether a sentence is still true.

**Blocked by:** None. The evidence is in this branch: `docs/superpowers/e2e/05-settings-and-tools.md` and `docs/superpowers/e2e/08-findings.md` (finding F1), with `screenshots/settings-diagnostics-limits-before-980.png` beside `screenshots/hf-read-decoded-before-980.png` — the pair as it stood when the contradiction was raised.

**Seams:**
- Reader capability limits (existing, `src/lib/readerIdentity.ts`) — catches an entry that contradicts a capability the app ships; misses nothing within its own scope, since the list is the only place these limits are stated.
- The reader readout (existing) — catches the decoder refusing a width the limits claim is refused; the two must be read together, which is what makes one test over both of them possible.

**Tracker:** None

**Status:** done

- [x] The *NDEF messages* entry describes NDEF as available, naming what is read and written and what remains unavailable: the message and its Records are read and written through the Type 2 TLV; password protection, APDU passthrough and MIFARE Classic sectors stay listed as unavailable in their own entries. — `src/lib/readerIdentity.ts`, `READER_CAPABILITY_LIMITS`, entry `ndef`: "Available through the Type 2 TLV. A Type 2 Tag's message is read and listed as Records, written back from a Draft, and erased", and it names the three entries that still stay unavailable.
- [x] The *7- and 10-byte UIDs* entry no longer claims a longer UID is raw. It states 4-, 7- and 10-byte widths decode from the reply's own length byte, and that 10 bytes has a decoder but no hardware confirmation — the spec's open question, stated as an open question rather than as a limit. — same list, entry `uid-width`, plus `readerIdentity.test.ts` → "states which UID widths decode, and that 10 bytes is unconfirmed on hardware".
- [x] No entry claims a capability is absent while a page in the same build offers it. — `readerIdentity.test.ts` → "does not deny a capability the app implements", which reads the limits against the modules that implement them.
- [x] A test fails if a limit's claim disagrees with the surface that implements it. — `readerIdentity.test.ts` → "the capability limits cannot contradict a capability the app ships": each guarded entry has a `claim` pattern (`/not readable or writable|never answered|raw payload only/i` and `/\braw bytes?\b|not decoded|only 4-byte/i`) that must not reappear, and "refutes the NDEF claim with the codec that reads and writes a message" and "refutes the UID claim with the decoder that splits a 7-byte UID" drive the surfaces themselves.
- [x] Nothing else in the list changes: MIFARE Classic sectors, APDU passthrough, password protection, factory restore and 125 kHz writability stay as they are, because each is still true. — the same five entries are present in `READER_CAPABILITY_LIMITS` with their original labels and claims.

**Closed by:** a fresh review's Standards/Spec pass on the integration SHA, which found the entries already corrected and the guard already in place; this file was the last thing still saying otherwise.
