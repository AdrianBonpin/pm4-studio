# 05: Restrict the raw console to commands that cannot alter a tag

**What to build:** In a release build the raw console sends only commands that cannot
change what a tag holds: the reads, the version and firmware queries, the poll, and the
Reader's own beep and LED. The 125 kHz write, the NTAG write, and every command not on
that list are refused, with the refused command named and a pointer to a development
build for write experiments. The console says it is read-only before it is used. Debug
builds are unchanged and still send anything.

**Blocked by:** 01

**Seams:** The console's command boundary. Catches an allow-list that widens by default,
a refusal that names nothing, and a read-only notice that appears only after a refusal.
Misses whether a permitted command is genuinely free of side effects — that is a protocol
claim, recorded and reviewed, not something a test can establish.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/8
**Status:** ready

- [ ] Release builds refuse the 125 kHz write, the NTAG write, and every unlisted command.
- [ ] A refusal names the refused command and says write experiments run in a development build.
- [ ] The console states that it is read-only before it is used, not when a frame is refused.
- [ ] Debug builds still send any command.
- [ ] Absence from the list is the refusal; adding an entry is the only way to permit one.
- [ ] Every permitted command still works for diagnosis.
- [ ] A write-guard refusal and a console refusal are distinguishable to the user.
