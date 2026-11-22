# 18: Replace the left-bar notice treatment app-wide

**What to build:** No message is announced only by a bar down one side of a rounded box. Persistent conditions get a full border or a tint plus a leading label or icon, so severity is carried by more than one channel and by more than colour alone.

**Blocked by:** 10, 11, 12, 13, 14, 15, 16, 17

**Seams:**
- Design check (existing, from 01) — catches every remaining occurrence of the treatment; misses whether the replacement actually communicates.
- Confirmation gates and vocabulary guard (existing) — catch a notice that lost its accessible name or its vocabulary in the rewrite; miss nothing currently covered.

The sweep runs after the page work rather than before, because sweeping interface that is about to be rewritten does the work twice.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/28
**Status:** done

- [x] No notice anywhere is announced only by a border down one side of a rounded box.
- [x] Persistent conditions use a full border or a tint, with a leading label or icon carrying the severity as well as colour.
- [x] Both light-independent channels are present: the severity is readable to a user who cannot distinguish the accent colours.
- [x] Every notice keeps its accessible name and its severity distinction, including the unwritable-library condition and the migration warning.
- [x] Anything that could be dismissed before can still be dismissed.
- [x] No notice that belonged inline was turned into a transient message, and none that was transient was made permanent.
- [x] The design check reports zero occurrences of the rule.
