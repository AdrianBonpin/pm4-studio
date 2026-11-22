# 09: Save a 13.56 MHz read as a Snapshot with its Records; schema v3

**What to build:** A 13.56 MHz read becomes as durable as a 125 kHz one. Saving it keeps the identity, the family, the capacity, the raw bytes and the message, so a tag you read once can be reviewed months later with no Reader attached and written from again.

**Blocked by:** 07, 08

**Seams:**
- Library store (extended) — catches the v3 migration, key preservation, version stamping, newer-file refusal and atomic replace; misses crash durability beyond the existing atomic-write coverage.
- Write outcome classification (existing) — catches a failed verification still counting a copy; misses nothing currently covered by it.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/21
**Status:** done

- [x] A 13.56 MHz read can be saved from its readout in one action, and the save reports its own outcome.
- [x] The saved Snapshot holds the UID, ATQA, SAK, card type, capacity, NDEF status, raw reply and the Records in order.
- [x] A duplicate read is reported as a duplicate rather than silently added twice.
- [x] A saved 13.56 MHz Snapshot is fully reviewable with no Reader attached.
- [x] A Snapshot's Records can be written back to a tag through the same confirmation and read-back verification a Draft uses, and only a verified write counts a copy.
- [x] The library file is version 3.
- [x] A version 2 file migrates to 3 eagerly on the first successful open with every key preserved and every entry in its original order. A version 1 file walks 1 to 2 to 3 in one open.
- [x] A file claiming a version this build does not understand is refused and left untouched, never rewritten.
- [x] A migration whose write fails is reported while the migrated library continues in memory; the app does not refuse to open.
- [x] A version 2 file that somehow holds a 13.56 MHz Snapshot keeps the fields that shape never carried absent and rendered as unavailable, never filled with a plausible value.
- [x] A Snapshot is still never edited except for its name and note.
