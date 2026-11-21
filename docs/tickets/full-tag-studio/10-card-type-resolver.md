# 10: Card type resolver

**What to build:** A known ATQA/SAK pair yields a card family, and additional detail only where that pair determines it uniquely. Pairs that identify a family but not a specific chip return the family with capacity explicitly unavailable, because those chips differ only in capacity and this Reader cannot ask them. Unknown pairs return nothing rather than a nearest guess.

**Blocked by:** None (can start immediately)

**Seams:**
- S6 Card type resolver — catches table errors, family-only results and unknown-pair handling; misses vendor-specific SAK variants.

**Tracker:** None
**Status:** done

- [x] Known pairs resolve to the correct family, proven against a table written independently of the implementation.
- [x] Pairs that identify only a family return the family with no capacity.
- [x] Unknown pairs return nothing rather than an approximate match.
- [x] No capacity is produced for a family whose size requires a command this Reader lacks.
- [x] Each family's result states which technologies are plausible for it.
