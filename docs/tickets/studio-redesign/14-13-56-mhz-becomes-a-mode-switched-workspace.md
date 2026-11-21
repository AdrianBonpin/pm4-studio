# 14: 13.56 MHz becomes a mode-switched workspace

**What to build:** On 13.56 MHz, operations come before troubleshooting. Read, Write, Erase and Memory are one click each, and the password panel — half a screen of explanation in front of two controls that can never work — is gone, its absence recorded once among the capability limits.

**Blocked by:** 03, 08

**Seams:**
- Outcome seam (existing) — catches a re-hosted operation that stopped reporting; misses nothing currently covered.
- Confirmation gates (existing) — catches an erase or a write whose confirmation was lost in the move; misses nothing currently covered.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/20
**Status:** done

- [x] The page offers Read, Write, Erase and Memory in that order, with one visible at a time, and takes a fifth mode without relayout when Copy arrives.
- [x] Every mode is reachable in one click and needs no scrolling at the minimum window size.
- [x] The password panel is removed from the interface entirely.
- [x] Password capability is recorded once in the capability limits as unavailable on this Reader, rather than re-explained on the page.
- [x] Memory holds the raw dump and its export, and the dump still states that it is evidence rather than a decode.
- [x] Erase keeps its framing that an erased tag is still a tag — it is not a Reset and does not make the tag Blank.
- [x] Writing a Draft to a tag is reachable from Write, with its confirmation, capacity check and read-back unchanged.
- [x] No capability limit is repeated on the page, because the limits live in one place now.
- [x] Neither the provisional badge nor its explanatory section appears anywhere.
