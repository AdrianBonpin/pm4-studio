# 21: Password set and remove

**What to build:** Password protection can be set and removed on a supported tag, behind a confirmation that states plainly that losing the password makes the tag permanently unrecoverable, and requires explicit acknowledgement rather than a default-accepted dialog.

**Blocked by:** 16, 17

**Seams:**
- S7 NDEF codec with S8 Library store — catches password payload construction and outcome classification; misses real lock semantics on the chip.

**Tracker:** None
**Status:** ready

- [ ] A password can be set, and protected access afterwards behaves as expected.
- [ ] Removing the password with the same value restores unprotected access.
- [ ] The confirmation states the tag becomes permanently unrecoverable if the password is lost, and requires explicit acknowledgement.
- [ ] A wrong password produces a clear error rather than a wedge.
- [ ] The user is told, at the point of setting, what happens if the password is not recorded anywhere.
- [ ] A tag whose password is unknown is never presented as recoverable.
