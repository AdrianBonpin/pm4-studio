# 02: Report every operation through one outcome seam, shown as a toast

**What to build:** An operation that ends says so on screen, in a corner you choose, for as long as its severity warrants — and nothing can end without saying so. The device-failure strip that currently shoves the page down when a cable is loose arrives as a message instead.

**Blocked by:** None (can start immediately)

**Seams:**
- Outcome seam — catches an operation with no outcome, and a message whose severity disagrees with the signal it would produce; misses whether the physical beeper sounded.
- Toast store — catches dismissal timing by severity, the cap, coalescing, corner choice, and keyboard dismissal; misses honest screen-reader behaviour, which the DOM harness only approximates.
- Confirmation gates (existing, unchanged) — catches a destructive control that stopped asking; misses nothing currently covered.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/12
**Status:** done

- [x] One typed outcome describes what an operation did, with a closed set of discriminators, and one entry point receives it.
- [x] Severity is a property of the outcome, not of the call site, so changing the vocabulary moves every message at once.
- [x] No component constructs a message directly; the seam is the only way one exists.
- [x] Messages appear in four settable corners, default bottom-right, and the choice survives a restart.
- [x] Success and informational clear at four seconds, warnings at eight, both within a one-second tolerance that tests inject rather than wait for; errors persist until dismissed or until the same operation later succeeds.
- [x] At most three are visible; older ones collapse into a count rather than being dropped silently.
- [x] Identical outcomes arriving in quick succession coalesce into one with a repeat count.
- [x] Every message is dismissible from the keyboard, none takes focus, and each is announced politely to a screen reader.
- [x] The shell's device-failure strip is gone and the same information arrives as a message, keeping its reconnect action and its dismiss.
- [x] A refusal caused by the build and a refusal caused by the tag in position produce different messages and remain distinguishable.
- [x] Conditions that persist — an unwritable library, a migration warning, an invalid Record, a pending confirmation — stay inline and never toast.
- [x] Messages render with no Reader attached.
- [x] The existing audible helper still works at the end of this ticket by routing through the seam, so call sites not yet rewired keep behaving as they do today.
