# 16: Edit as Draft from a 13.56 MHz readout

**What to build:** Editing what is on a tag no longer begins with a trip to another page. A message you just read becomes a Draft in one action, and you land in it.

**Blocked by:** 08, 10

**Seams:**
- Collection switch (existing) — catches landing in the wrong collection or on no Draft; misses nothing currently covered.
- NDEF codec (existing) — catches a Record that loses its kind or fields on the way; misses how the source tag encoded it.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/26
**Status:** done

- [x] The action is present on a readout that has Records, and absent on one whose Records could not be fetched, because there is nothing to copy.
- [x] One action creates a Draft from the read message, switches Library to the Drafts collection and opens that Draft.
- [x] Record kinds, fields and order survive the transfer exactly, and the resulting Draft re-encodes to a message the tag would accept.
- [x] Naming the new Draft does not require a dialog before the Draft exists; it opens with a usable default and can be renamed in place.
- [x] The action reports its own outcome and is audible like any other operation.
- [x] It never modifies the tag it was read from.
