# 05: Choose a Draft by its name or by what is inside it

**What to build:** 13.56 MHz Write mode shows every Draft as a list instead of hiding them
one at a time in a menu. A search field sits above the list and narrows it as the user
types, matching a Draft's name, its id, or anything authored inside its Records — a URL, a
phone number, a Wi-Fi name, a line of text. Nothing is chosen until the user chooses;
choosing opens the write panel for that Draft, and leaving the mode forgets the choice.

**Blocked by:** None (can start immediately)

**Seams:**
- The Drafts module's pure search — a Draft and a query in, a list out. Catches matching on
  name, id and authored Record values; case and whitespace tolerance; an empty query
  leaving the list untouched; a Draft whose Record cannot be encoded still being listed.
  Misses what the screen does with the result.
- The Write mode as rendered — catches the search field appearing only when there is more
  than one Draft; the list narrowing as the user types; the no-match sentence and its
  count; nothing pressed on arrival; a choice revealing the write panel; the choice gone
  after leaving the mode and returning. Misses the painted row height and the scroll cap.

- [x] Write mode lists every Draft with its name, its Record count, its encoded size and how long ago it changed.
- [x] Typing narrows the list by name, id, or any value authored inside the Draft's Records, case-insensitively and ignoring spacing.
- [x] With exactly one Draft, no search field is shown and that Draft is still chosen by the user rather than for them.
- [x] Nothing is selected when the mode opens.
- [x] A query that matches nothing says so in words and states how many Drafts exist.
- [x] The search field and the list are reachable by keyboard alone, and a Draft can be chosen without a mouse.
- [x] Choosing a Draft opens the write panel for it, and leaving the mode and returning shows no choice.
- [x] The comparison is one rule shared with Snapshot search, not a second copy of it.
- [x] The native select module's comment states the current policy — a growing list is an in-app list with search — instead of arguing the opposite.
- [x] The 13.56 MHz page tests that used the dropdown as their marker for "Write mode is showing" pass against the list.
- [x] `bun run verify` passes.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/36
**Status:** done
