//! The raw console's command boundary: a closed allow-list in release builds
//! (ADR 0006).
//!
//! The console sends whatever frame it is typed, which is how every verified
//! frame in `docs/PROTOCOL.md` was found — and also how a hand-computed
//! `0x0082` can reach an NTAG's configuration pages and make a Tag permanently
//! unusable. Every destructive operation elsewhere in the app passes a guard;
//! the console passed none. ADR 0006 keeps the instrument and closes the route:
//!
//!   - A release build sends only the commands on [`RELEASE_ALLOWED`], each of
//!     which cannot change what a Tag holds.
//!   - A debug build sends anything, so protocol work continues from
//!     `cargo run` rather than from the app the user runs daily.
//!
//! The list is an allow-list and that is the whole point. Absence from it is the
//! refusal, so an opcode discovered tomorrow is refused in a release build
//! until someone states in the ADR why it is safe. A deny-list would give the
//! opposite default and would be wrong the first time the protocol grew — and
//! `0x0081` through `0x0085` were all found by accident.
//!
//! This module decides only. It sends nothing and touches no Reader, so the
//! decision is provable without a device plugged in.

use serde::Serialize;

/// One command a release build may send, with the name `ADR 0006` gives it.
pub struct Allowed {
    /// The command id as it appears in a frame, e.g. `0x0051`.
    pub cmd: u16,
    /// What the command does, in the ADR's words.
    pub name: &'static str,
}

/// Every command a release build sends. Closed: anything not here is refused.
///
/// Each entry is a command that cannot change what a Tag holds — the Reader's
/// own actuators, the version query, and the reads. Adding an entry is the only
/// way to permit one, and the entry is a claim that has to be argued in the ADR
/// first.
pub const RELEASE_ALLOWED: [Allowed; 8] = [
    Allowed { cmd: 0x0051, name: "wake / select" },
    Allowed { cmd: 0x0053, name: "beep and LED on" },
    Allowed { cmd: 0x0054, name: "firmware version" },
    Allowed { cmd: 0x0055, name: "LED off" },
    Allowed { cmd: 0x0069, name: "13.56 MHz poll" },
    Allowed { cmd: 0x0072, name: "125 kHz read" },
    Allowed { cmd: 0x0081, name: "NTAG read" },
    Allowed { cmd: 0x0083, name: "NTAG info" },
];

/// Whether `cmd` is one a release build may send.
///
/// A lookup in the list above, never a condition that a new command could
/// satisfy by default.
pub fn permits(cmd: u16) -> bool {
    RELEASE_ALLOWED.iter().any(|allowed| allowed.cmd == cmd)
}

/// What this build of the app is allowed to send.
///
/// Two states, not a setting: it is fixed when the binary is built, which is
/// what makes the dangerous mode something you run from a terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    /// A release build: only [`RELEASE_ALLOWED`].
    ReadOnly,
    /// A development build: anything, as before.
    Full,
}

impl Capability {
    /// True when the console sends only commands that cannot change a Tag.
    pub fn is_read_only(self) -> bool {
        matches!(self, Capability::ReadOnly)
    }
}

/// The capability this binary was built with.
///
/// `#[cfg]` decides, not a runtime setting and not the webview: a user cannot
/// reach the full range in the shipped app, and the webview is told which mode
/// it is in rather than assuming one.
pub const CAPABILITY: Capability = if cfg!(debug_assertions) {
    Capability::Full
} else {
    Capability::ReadOnly
};

/// What the console decides about one frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// The frame may be sent.
    Send,
    /// Refused before the Reader was opened: this build does not send it.
    Refuse { cmd: u16 },
}

impl Decision {
    /// True only for `Send`.
    pub fn sends(self) -> bool {
        matches!(self, Decision::Send)
    }

    /// The refusal to hand the webview, or `None` when the frame may be sent.
    pub fn refusal(self) -> Option<ConsoleError> {
        match self {
            Decision::Send => None,
            Decision::Refuse { cmd } => Some(refused(cmd)),
        }
    }
}

/// Decide whether one command may be sent by a build with `capability`.
///
/// The full range is a debug-only state, so the only question a release build
/// asks is whether the command is on the list.
pub fn decide(capability: Capability, cmd: u16) -> Decision {
    match capability {
        Capability::Full => Decision::Send,
        Capability::ReadOnly if permits(cmd) => Decision::Send,
        Capability::ReadOnly => Decision::Refuse { cmd },
    }
}

/// A command id as it is named to the user: `0x0073`.
pub fn command_name(cmd: u16) -> String {
    format!("0x{cmd:04X}")
}

/// The command a typed frame names: byte 1 is the high half of the id, byte 2
/// the low half (`docs/PROTOCOL.md`, frame format).
///
/// A frame too short to name one reports `0x0000`, which is on no list — so a
/// release build refuses it rather than sending a frame whose effect nobody
/// stated.
pub fn command_in(frame: &[u8]) -> u16 {
    match (frame.get(1), frame.get(2)) {
        (Some(hi), Some(lo)) => u16::from_be_bytes([*hi, *lo]),
        _ => 0,
    }
}

/// Why a console frame was not sent, in the shape the webview renders.
///
/// The two cases are kept apart deliberately. `refusedByBuild` is a decision by
/// this build's allow-list; `failed` is a malformed frame or the Reader. A
/// console refusal is not a write-guard refusal — one is about the build, the
/// other about the Tag in position — and the webview must be able to show them
/// as different news without reading prose to guess which it has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConsoleError {
    /// This build does not send that command (ADR 0006).
    RefusedByBuild { cmd: String, message: String },
    /// The frame or the Reader failed; nothing was decided about the command.
    Failed { message: String },
}

impl ConsoleError {
    /// A frame or transport failure, which says nothing about the build.
    pub fn failed(message: impl Into<String>) -> Self {
        ConsoleError::Failed {
            message: message.into(),
        }
    }
}

/// The refusal for one command, as the webview receives it.
pub fn refused(cmd: u16) -> ConsoleError {
    ConsoleError::RefusedByBuild {
        cmd: command_name(cmd),
        message: refusal_message(cmd),
    }
}

/// What the user is told when this build refuses a frame.
///
/// It names the command it refused and says where write experiments run. A
/// refusal that only said "not permitted" would read as a bug, and the next
/// thing a user does is look for a way around it.
pub fn refusal_message(cmd: u16) -> String {
    format!(
        "this build sends only commands that cannot change a tag, so {} was refused. \
         Write experiments run in a development build — start it with `cargo run` from the \
         repository instead of opening the installed app.",
        command_name(cmd)
    )
}

/// One permitted command, as the console lists it before it is used.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowedView {
    pub cmd: String,
    pub name: &'static str,
}

/// What the webview asks for before the console is used, so the console marks
/// itself from the backend's capability rather than from an assumption of its
/// own.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityView {
    /// True in a release build: only `commands` are sent.
    pub read_only: bool,
    /// The commands this build sends. Empty when it is not read-only.
    pub commands: Vec<AllowedView>,
}

/// The capability as the console is told it.
pub fn capability_view(capability: Capability) -> CapabilityView {
    let read_only = capability.is_read_only();
    CapabilityView {
        read_only,
        commands: if read_only {
            RELEASE_ALLOWED
                .iter()
                .map(|allowed| AllowedView {
                    cmd: command_name(allowed.cmd),
                    name: allowed.name,
                })
                .collect()
        } else {
            Vec::new()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 125 kHz write: the destructive 24-byte path.
    const LF_WRITE: u16 = 0x0073;
    /// The NTAG write: reaches config pages 131, 133 and 134.
    const NTAG_WRITE: u16 = 0x0082;

    #[test]
    fn a_release_build_refuses_the_125_khz_write() {
        let decision = decide(Capability::ReadOnly, LF_WRITE);
        assert_eq!(decision, Decision::Refuse { cmd: LF_WRITE });
        assert!(!decision.sends());
    }

    #[test]
    fn a_release_build_refuses_the_ntag_write() {
        let decision = decide(Capability::ReadOnly, NTAG_WRITE);
        assert_eq!(decision, Decision::Refuse { cmd: NTAG_WRITE });
        assert!(!decision.sends());
    }

    #[test]
    fn a_release_build_sends_every_command_on_the_list() {
        // Each permitted command, by the id the ADR records — so a typo in the
        // table makes the command unavailable rather than making a write
        // available, and this test says which one went missing.
        for (cmd, _) in [
            (0x0051u16, "wake"),
            (0x0053, "beep and LED"),
            (0x0054, "version"),
            (0x0055, "LED off"),
            (0x0069, "13.56 MHz poll"),
            (0x0072, "125 kHz read"),
            (0x0081, "NTAG read"),
            (0x0083, "NTAG info"),
        ] {
            assert_eq!(
                decide(Capability::ReadOnly, cmd),
                Decision::Send,
                "{} should still be sent for diagnosis",
                command_name(cmd)
            );
        }
    }

    #[test]
    fn absence_from_the_list_is_the_refusal() {
        // Walk every id a frame can carry. Exactly the listed ones are sent, so
        // an opcode nothing has written down yet is refused by default rather
        // than permitted by default.
        let permitted: Vec<u16> = (0..=u16::MAX)
            .filter(|cmd| decide(Capability::ReadOnly, *cmd).sends())
            .collect();
        let listed: Vec<u16> = RELEASE_ALLOWED.iter().map(|allowed| allowed.cmd).collect();
        assert_eq!(permitted, listed);
        // Eight of sixty-five thousand: the list is small enough to read.
        assert_eq!(permitted.len(), 8);
    }

    #[test]
    fn a_command_nobody_has_classified_is_refused() {
        // 0x0084 and 0x0085 were found by accident; the next one will not
        // announce whether it writes.
        for cmd in [0x0084u16, 0x0085, 0x0080, 0x006A, 0x0000, 0xFFFF] {
            assert_eq!(
                decide(Capability::ReadOnly, cmd),
                Decision::Refuse { cmd },
                "{} is not on the list, so a release build must refuse it",
                command_name(cmd)
            );
        }
    }

    #[test]
    fn a_debug_build_sends_anything() {
        for cmd in [LF_WRITE, NTAG_WRITE, 0x0084, 0x0085, 0x0000, 0xFFFF] {
            assert_eq!(
                decide(Capability::Full, cmd),
                Decision::Send,
                "{} must still be available to protocol work",
                command_name(cmd)
            );
        }
    }

    #[test]
    fn the_refusal_names_the_command_it_refused() {
        let message = refusal_message(LF_WRITE);
        assert!(message.contains("0x0073"), "{message}");
        let message = refusal_message(NTAG_WRITE);
        assert!(message.contains("0x0082"), "{message}");
    }

    #[test]
    fn the_refusal_says_write_experiments_run_in_a_development_build() {
        let message = refusal_message(NTAG_WRITE);
        assert!(message.contains("development build"), "{message}");
        assert!(message.contains("cargo run"), "{message}");
    }

    #[test]
    fn the_refusal_is_about_the_build_not_the_tag_in_position() {
        // A write-guard refusal says the Tag could not be read or already
        // carries the Identity. A console refusal must not read like either,
        // or a user would put a different Tag on the Reader and try again.
        let message = refusal_message(LF_WRITE);
        assert!(message.contains("this build"), "{message}");
        assert!(!message.contains("could not read the tag"), "{message}");
        assert!(!message.contains("already reads as"), "{message}");
    }

    #[test]
    fn a_refusal_carries_the_command_and_the_reason() {
        let refusal = decide(Capability::ReadOnly, NTAG_WRITE)
            .refusal()
            .expect("a refusal is returned for a refused command");
        match refusal {
            ConsoleError::RefusedByBuild { cmd, message } => {
                assert_eq!(cmd, "0x0082");
                assert!(message.contains("development build"), "{message}");
            }
            other => panic!("expected a build refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_sent_frame_has_no_refusal() {
        assert_eq!(decide(Capability::ReadOnly, 0x0081).refusal(), None);
        assert_eq!(decide(Capability::Full, LF_WRITE).refusal(), None);
    }

    #[test]
    fn the_frame_names_the_command_it_carries() {
        // The wake frame from PROTOCOL.md, and the two write frames.
        let wake = crate::reader::parse_hex("55 00 51 00 01 01 FE 01").expect("hex parses");
        assert_eq!(command_in(&wake), 0x0051);
        let lf_write = crate::reader::parse_hex("55 00 73 00 18 00 00 00").expect("hex parses");
        assert_eq!(command_in(&lf_write), LF_WRITE);
        let ntag_write = crate::reader::parse_hex("55 00 82 05 30 FD 02").expect("hex parses");
        assert_eq!(command_in(&ntag_write), NTAG_WRITE);
    }

    #[test]
    fn a_frame_too_short_to_name_a_command_names_none() {
        // Named as 0x0000, which is on no list: a release build refuses it
        // instead of sending a frame whose effect nobody has stated.
        assert_eq!(command_in(&[]), 0);
        assert_eq!(command_in(&[0x55]), 0);
        assert_eq!(command_in(&[0x55, 0x00]), 0);
        assert!(!decide(Capability::ReadOnly, command_in(&[0x55, 0x00])).sends());
    }

    #[test]
    fn the_built_capability_is_the_one_the_compiler_flag_states() {
        // Debug builds (including this test's own build) keep the full range, so
        // this asserts `Full` here and asserts `ReadOnly` in the same test run
        // under `--release`. A capability hardcoded to either mode fails one of
        // those two runs.
        if cfg!(debug_assertions) {
            assert_eq!(CAPABILITY, Capability::Full);
        } else {
            assert_eq!(CAPABILITY, Capability::ReadOnly);
        }
    }

    #[test]
    fn the_built_capability_decides_the_write_commands() {
        // The constant `raw_send` and `send_cmd` consult, rather than a
        // capability handed in by the test: this is the split as the app uses
        // it. A debug build sends the writes; a release build refuses them.
        assert_eq!(
            !decide(CAPABILITY, LF_WRITE).sends(),
            !cfg!(debug_assertions),
            "the built capability must refuse the 125 kHz write in a release build"
        );
        assert_eq!(
            !decide(CAPABILITY, NTAG_WRITE).sends(),
            !cfg!(debug_assertions),
            "the built capability must refuse the NTAG write in a release build"
        );
        // And every permitted command is sent in either mode, so diagnosis is
        // never a casualty of the restriction.
        for allowed in RELEASE_ALLOWED.iter() {
            assert!(
                decide(CAPABILITY, allowed.cmd).sends(),
                "{} must be sent in this build too",
                command_name(allowed.cmd)
            );
        }
    }

    #[test]
    fn the_capability_view_lists_the_commands_a_release_build_sends() {
        let view = capability_view(Capability::ReadOnly);
        assert!(view.read_only);
        let named: Vec<&str> = view.commands.iter().map(|c| c.cmd.as_str()).collect();
        assert_eq!(
            named,
            [
                "0x0051", "0x0053", "0x0054", "0x0055", "0x0069", "0x0072", "0x0081", "0x0083"
            ]
        );
        // Named, so the console can say what it does send rather than leaving a
        // user to guess which of eight hex ids are reads.
        assert!(view.commands.iter().any(|c| c.name == "NTAG read"));
    }

    #[test]
    fn a_debug_build_tells_the_console_it_is_not_read_only() {
        // The webview is never told a debug build is read-only, so the shipped
        // warning cannot appear on a build that does not have the limit.
        let view = capability_view(Capability::Full);
        assert!(!view.read_only);
        assert!(view.commands.is_empty());
    }
}
