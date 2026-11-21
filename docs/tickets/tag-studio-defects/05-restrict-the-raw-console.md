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
**Status:** done

**Implementation (2026-11-22).** The allow-list is `src-tauri/src/console.rs`: eight
commands, each carrying the name ADR 0006 gives it, and `decide` asks only whether the
id is *on* that list. `raw_send` and `send_cmd` consult it before the Reader is opened,
so a refused frame reaches no device and does not even claim the USB handle. A refusal
crosses the boundary as a tagged value (`{ kind: "refusedByBuild", cmd, message }`)
rather than a sentence, which is what lets the console show it as a limit of the build;
a write-guard refusal still arrives as plain text about the Tag in position, so the two
cannot look alike. `console_capability` reports the mode and the permitted commands, and
the console states its read-only notice from that answer before it is used.

**How the debug/release split is proved without shipping two binaries.** `CAPABILITY` is
`if cfg!(debug_assertions) { Full } else { ReadOnly }`, and the decision is a pure
function of `(capability, cmd)`, so one test binary covers both modes. Two tests consult
the built constant rather than a capability handed in: one asserts it equals the mode
`cfg!(debug_assertions)` declares, the other that it refuses `0x0073`/`0x0082` exactly
when the compiler flag says release. They pass as `Full` under `cargo test` and assert
`ReadOnly` under `cargo test --release`; the whole `console::` suite was run in both
modes (17 passed each), and hardcoding `CAPABILITY` to `Full` was checked to fail the
release run.

- [x] Release builds refuse the 125 kHz write, the NTAG write, and every unlisted command.
- [x] A refusal names the refused command and says write experiments run in a development build.
- [x] The console states that it is read-only before it is used, not when a frame is refused.
- [x] Debug builds still send any command.
- [x] Absence from the list is the refusal; adding an entry is the only way to permit one.
- [x] Every permitted command still works for diagnosis.
- [x] A write-guard refusal and a console refusal are distinguishable to the user.
