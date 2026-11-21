# 02: Reader identity — single instance, firmware version, stated limits

**What to build:** Launching the app a second time brings the existing window forward instead of starting a second process that fights for the exclusive USB handle and surfaces an opaque access error. The Reader's firmware revision is visible, so a bug report can name the hardware. The app states this Reader's capability limits once, in one place, instead of repeating "unavailable" against every tag it reads.

**Blocked by:** None (can start immediately)

**Seams:** No new seam. Verified through the app shell against the physical Reader.

**Tracker:** None
**Status:** ready

- [ ] Launching a second instance surfaces the existing window and never produces a USB access error.
- [ ] The Reader's firmware revision is visible without opening a raw console.
- [ ] With no Reader attached the app says so plainly and stays usable.
- [ ] A device operation that wedges the firmware tells the user to replug, rather than leaving the interface waiting.
- [ ] The capability limits of this Reader are stated once, in one place, and are not repeated on every tag.
