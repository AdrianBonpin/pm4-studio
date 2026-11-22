# 03: Five destinations, a Settings page, and a slimmer Tools

**What to build:** The sidebar becomes navigation plus connection and nothing else: 125 kHz, 13.56 MHz, Library, Tools, Settings. Library holds both Snapshots and Drafts, so removing Drafts as a destination cannot orphan it. Settings collects the preferences, the version, the credits and the limits that are currently scattered.

**Blocked by:** 02

**Seams:**
- Vocabulary guard — catches a retired word in a destination label or a page subtitle; misses a retired word in a heading that is not routed through the shared page copy.
- Confirmation gates (existing) — catches a packaged control that stopped asking; misses nothing currently covered.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/14
**Status:** done

- [x] The sidebar offers exactly five destinations, and the current one is marked for assistive technology.
- [x] The destination you are on survives navigating away and back within a session.
- [x] Drafts is reachable inside Library as a second collection, so no saved thing is unreachable at any point in the work.
- [x] Settings opens with Feedback, About and Diagnostics, each reachable in one click; the page is built to take a fourth group without relayout.
- [x] Feedback holds a control over the corner messages appear in, persisted, and a beep test.
- [x] About shows the version, the credits, the repository link, the licence, and the Reader's product, manufacturer, serial and firmware.
- [x] The version has one authoritative source, and a test fails when either of the other two build manifests disagrees with it.
- [x] Diagnostics holds the indicator test — a beep and an LED-off — and the capability limits, so a limitation is stated once rather than repeated per tag.
- [x] Tools holds only the raw console, including the release build's read-only statement, which is shown before the console is used rather than when a frame is refused.
- [x] The sidebar no longer carries a beep control, and the control is not disabled by the Reader being disconnected.
- [x] The credits footer that repeated on every page is gone.
- [x] Every destination is reachable and renders with no Reader attached.
