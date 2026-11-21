//! Password protection on an NTAG21x: what this Reader can do about it, which
//! is nothing, and why that is the honest answer rather than a gap.
//!
//! Password protection on an NTAG21x is three values in the configuration area:
//!
//! | Page | Holds |
//! |---|---|
//! | 131 (`0x83`) | `AUTH0` — the first page that requires authentication, `ACCESS`, `VCTID`, `RFUI` |
//! | 133 (`0x85`) | `PWD` — the 4-byte password |
//! | 134 (`0x86`) | `PACK` — the 2-byte password acknowledge |
//!
//! Writing those pages is how protection is enabled. **Enabling it is only half
//! a feature**: every read or write at or after `AUTH0` then requires a
//! `PWD_AUTH` command carrying `PWD`, and the write that would put `AUTH0` back
//! to `0xFF` sits behind that same protection. This protocol has no
//! authentication command at all — `0x0083` info, `0x0081` read, `0x0082` write,
//! `0x0085` progress and `0x0084` format are the whole family (docs/PROTOCOL.md).
//! There is no `PWD_AUTH`, no MIFARE key authentication, and no APDU passthrough.
//!
//! So setting a password here would be a one-way door with the key inside. That
//! is refused by construction: [`decide`] returns `Result<Infallible, _>`, which
//! is a type with no success value, so no caller can reach a config-page write
//! through this module even by mistake.
//!
//! There is a second, independent reason not to trust a "set" here. The
//! configuration area this firmware reports is not the Tag's real configuration:
//! page 131 reads `04 00 00 FF` on every Tag (two different UIDs, one of them
//! also written successfully), which would place `AUTH0` at page 4 and make the
//! whole user area require authentication — yet page 4 onwards reads back in
//! full with state `1`. A dump whose `AUTH0` byte is contradicted by the readable
//! memory it claims to protect is not a config read. See docs/PROTOCOL.md "Open
//! problems" 5.
//!
//! Consequences this module encodes:
//!
//!   * Protection status of a Tag **cannot be determined** by this Reader, so a
//!     Tag is never presented as recoverable: [`ProtectionStatus::Unknown`] is
//!     the only status it can ever return.
//!   * No operation is offered without an explicit acknowledgement, and the
//!     acknowledgement is necessary but never sufficient.
//!   * Nothing in here touches the device. The commands built on this module
//!     either read (status) or refuse without sending a frame.

use crate::ntag::MemoryImage;

/// First page of the NTAG21x configuration area. Pages from here on hold lock
/// bytes and configuration (`AUTH0`, `PWD`, `PACK`) and are never user memory,
/// whatever a Tag's Capability Container claims.
pub const CONFIG_FIRST_PAGE: usize = 130;
/// Page holding `AUTH0` (byte 0), `ACCESS`, `VCTID`, `RFUI`.
pub const AUTH0_PAGE: usize = 131;
/// Page holding `PWD`, the 4-byte password.
pub const PWD_PAGE: usize = 133;
/// Page holding `PACK` and two `RFUI` bytes.
pub const PACK_PAGE: usize = 134;
/// `AUTH0` value that disables password protection: no page requires it.
pub const AUTH0_DISABLED: u8 = 0xFF;

/// Whether this protocol has any command that authenticates a 13.56 MHz Tag.
///
/// It does not. `docs/PROTOCOL.md` records the whole command family; nothing in
/// it carries a password. Any future firmware that changed this would have to be
/// proved on hardware first, and this constant is where that finding would land.
pub const READER_CAN_AUTHENTICATE: bool = false;

/// Whether the configuration pages this Reader reports are the Tag's real
/// configuration.
///
/// They are not: `AUTH0` reads `0x04` on every Tag, including Tags whose user
/// memory is fully readable — which a real `AUTH0` of `4` would forbid.
pub const CONFIG_PAGES_ARE_REAL: bool = false;

// ---- what the configuration area reads as ------------------------------

/// The configuration pages exactly as the Reader returned them.
///
/// Deliberately named `..._read`: these are bytes a firmware produced, not
/// values that are trusted to mean what the NTAG21x datasheet says they mean.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConfigPages {
    /// Page 131: `AUTH0`, `ACCESS`, `VCTID`, `RFUI`.
    pub auth0_page_read: Option<[u8; 4]>,
    /// Page 133: `PWD`.
    pub pwd_page_read: Option<[u8; 4]>,
    /// Page 134: `PACK` and two `RFUI` bytes.
    pub pack_page_read: Option<[u8; 4]>,
    /// Whether [`Self::auth0_page_read`] is the Tag's real `AUTH0` word.
    pub real_configuration: bool,
}

impl ConfigPages {
    /// Take the configuration pages out of a memory read.
    ///
    /// Always `real_configuration: false` on this Reader; see
    /// [`CONFIG_PAGES_ARE_REAL`] and docs/PROTOCOL.md open problem 5. Recording
    /// the read anyway means the UI can show what the Reader said while saying,
    /// in the same breath, that it is not the Tag's configuration.
    pub fn from_image(image: &MemoryImage) -> Self {
        ConfigPages {
            auth0_page_read: image.page(AUTH0_PAGE),
            pwd_page_read: image.page(PWD_PAGE),
            pack_page_read: image.page(PACK_PAGE),
            real_configuration: CONFIG_PAGES_ARE_REAL,
        }
    }
}

/// What can be said about a Tag's password protection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtectionStatus {
    /// Cannot be determined. The only status this Reader can produce.
    Unknown,
    /// `AUTH0 = 0xFF`: nothing requires a password.
    Disabled,
    /// `AUTH0` names a page, so every access at or after it needs the password.
    /// Unreachable on this Reader, because no configuration read is real.
    Enabled { auth0: u8 },
}

impl ProtectionStatus {
    /// The status as the UI names it.
    pub fn as_str(self) -> &'static str {
        match self {
            ProtectionStatus::Unknown => "unknown",
            ProtectionStatus::Disabled => "disabled",
            ProtectionStatus::Enabled { .. } => "enabled",
        }
    }

    /// True only for a status that a real configuration read would prove.
    pub fn is_known(self) -> bool {
        !matches!(self, ProtectionStatus::Unknown)
    }
}

/// What the protection state is, from the configuration pages as read.
///
/// A missing page, or a configuration read that is not real, is `Unknown` — never
/// guessed at, because "disabled" is the answer that would invite a user to treat
/// a protected Tag as a working one.
pub fn protection_status(config: Option<&ConfigPages>) -> ProtectionStatus {
    let Some(config) = config else {
        return ProtectionStatus::Unknown;
    };
    if !config.real_configuration {
        return ProtectionStatus::Unknown;
    }
    match config.auth0_page_read {
        Some(page) if page[0] == AUTH0_DISABLED => ProtectionStatus::Disabled,
        Some(page) => ProtectionStatus::Enabled { auth0: page[0] },
        None => ProtectionStatus::Unknown,
    }
}

// ---- the decision -------------------------------------------------------

/// The two password operations a user can ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordOperation {
    Set,
    Remove,
}

impl PasswordOperation {
    pub fn as_str(self) -> &'static str {
        match self {
            PasswordOperation::Set => "set",
            PasswordOperation::Remove => "remove",
        }
    }

    /// The configuration pages this operation would have to change, in order.
    ///
    /// Setting writes `AUTH0`, `PWD` and `PACK`. Removing writes `AUTH0` back to
    /// [`AUTH0_DISABLED`], which is the step that cannot be reached on a
    /// protected Tag without authenticating first.
    pub fn config_pages(self) -> Vec<usize> {
        match self {
            PasswordOperation::Set => vec![AUTH0_PAGE, PWD_PAGE, PACK_PAGE],
            PasswordOperation::Remove => vec![AUTH0_PAGE],
        }
    }
}

/// One requested operation, with the acknowledgement the user gave and the
/// protection state that was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PasswordRequest {
    pub operation: PasswordOperation,
    /// True only when the user explicitly acknowledged the warning. Defaults to
    /// false at every call site: there is no default-accepted path.
    pub acknowledged: bool,
    pub protection: ProtectionStatus,
}

impl PasswordRequest {
    /// A request with nothing acknowledged and nothing known, which is the only
    /// state the UI can start from.
    pub fn new(operation: PasswordOperation) -> Self {
        PasswordRequest {
            operation,
            acknowledged: false,
            protection: ProtectionStatus::Unknown,
        }
    }
}

/// Why a password operation did not happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordRefusal {
    /// The user did not tick the acknowledgement. Nothing else was considered.
    NotAcknowledged,
    /// This Reader's protocol has no command that authenticates a Tag.
    CannotAuthenticate,
    /// The protection state cannot be determined, so nothing may be concluded
    /// about whether the Tag is protected — and never that it is recoverable.
    ProtectionUnknown,
    /// The configuration area could not be read at all.
    ConfigUnreadable,
    /// `AUTH0 = 0xFF`: there is no password to remove.
    NothingToRemove,
    /// A write tried to mark a configuration page. Refused unconditionally.
    ConfigPageWrite { page: usize },
}

impl PasswordRefusal {
    /// Stable machine code, for the UI and for tests.
    pub fn code(self) -> &'static str {
        match self {
            PasswordRefusal::NotAcknowledged => "not-acknowledged",
            PasswordRefusal::CannotAuthenticate => "cannot-authenticate",
            PasswordRefusal::ProtectionUnknown => "protection-unknown",
            PasswordRefusal::ConfigUnreadable => "config-unreadable",
            PasswordRefusal::NothingToRemove => "nothing-to-remove",
            PasswordRefusal::ConfigPageWrite { .. } => "config-page-write",
        }
    }

    /// The sentence the user is shown. Written to be actionable, and to name the
    /// consequence rather than the internals.
    pub fn message(self) -> String {
        match self {
            PasswordRefusal::NotAcknowledged => "Nothing was written: the warning that a \
                 lost password makes a Tag permanently unrecoverable has to be acknowledged \
                 before a password operation can even be asked for."
                .to_string(),
            PasswordRefusal::CannotAuthenticate => "Refused, and nothing was written. This \
                 Reader's protocol has no command that authenticates a Tag, so the app cannot \
                 satisfy a password it sets. Protection would be one-way: once AUTH0 is set, \
                 the write that puts it back to 0xFF is itself behind the protection. A Tag \
                 protected here would be permanently unrecoverable."
                .to_string(),
            PasswordRefusal::ProtectionUnknown => "Nothing was written or cleared. This Reader \
                 cannot read a Tag's real AUTH0, so whether the Tag is protected cannot be \
                 determined. A Tag whose password is unknown is never treated as recoverable \
                 here."
                .to_string(),
            PasswordRefusal::ConfigUnreadable => "Nothing was written. The Tag's configuration \
                 area could not be read, so no conclusion about its protection is possible."
                .to_string(),
            PasswordRefusal::NothingToRemove => "Nothing was changed: AUTH0 reads as 0xFF, which \
                 means no page of the Tag requires a password, so there is nothing to remove."
                .to_string(),
            PasswordRefusal::ConfigPageWrite { page } => format!(
                "Refused: page {page} is configuration, not user memory. Writing it could \
                 enable password protection, which this Reader cannot undo."
            ),
        }
    }

    /// The sentence the UI shows above the refusal, naming what it cost: nothing.
    pub fn notice(self) -> String {
        format!("{} Nothing was sent to the Reader.", self.message())
    }
}

/// The guard a configuration-page write must pass. It refuses every page in the
/// configuration area, and every page at or above [`CONFIG_FIRST_PAGE`].
///
/// This is the second lock on the same door: [`decide`] already refuses both
/// operations, and this refuses the page set any future implementation would
/// have to mark. `ntag::guard_write_page` restricts writes to user memory, but
/// its limit comes from the Tag's own Capability Container — a bogus CC claiming
/// more pages than the chip has would let a write through without this.
pub fn guard_config_write(pages: &[usize]) -> Result<(), PasswordRefusal> {
    match pages.iter().copied().find(|page| *page >= CONFIG_FIRST_PAGE) {
        Some(page) => Err(PasswordRefusal::ConfigPageWrite { page }),
        None => Ok(()),
    }
}

/// Decide whether a password operation may proceed.
///
/// The return type has no success value: `Infallible` cannot be constructed, so
/// "allowed" is not representable. That is the point of this ticket — the
/// dangerous half is not implemented, rather than implemented and switched off.
///
/// The order matters, because each answer tells the user something different:
///
/// 1. No acknowledgement, no operation — and no other reason is even considered.
/// 2. Setting is refused because this Reader cannot authenticate.
/// 3. Removing needs a known protection state to know whether there is anything
///    to remove, and a way in if there is.
pub fn decide(request: &PasswordRequest) -> Result<std::convert::Infallible, PasswordRefusal> {
    if !request.acknowledged {
        return Err(PasswordRefusal::NotAcknowledged);
    }
    match request.operation {
        PasswordOperation::Set => Err(PasswordRefusal::CannotAuthenticate),
        PasswordOperation::Remove => match request.protection {
            ProtectionStatus::Unknown => Err(PasswordRefusal::ProtectionUnknown),
            ProtectionStatus::Disabled => Err(PasswordRefusal::NothingToRemove),
            // A protected Tag cannot be opened without PWD_AUTH, and the write
            // that would clear AUTH0 sits behind the protection it clears.
            ProtectionStatus::Enabled { .. } => Err(PasswordRefusal::CannotAuthenticate),
        },
    }
}

// ---- what the panel is told --------------------------------------------

/// Everything the password panel needs to say about the Tag on the Reader.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasswordReport {
    /// UID of the Tag that was read, when one was.
    pub uid: Option<String>,
    /// User capacity in bytes, from the Capability Container.
    pub capacity_bytes: Option<usize>,
    /// What can be said about protection. Always `Unknown` here.
    pub protection: ProtectionStatus,
    /// The configuration pages as read, when the read carried them.
    pub config: Option<ConfigPages>,
    /// Why protection cannot be determined, in one sentence.
    pub why_unknown: String,
    /// Pages setting a password would have to change. Never written.
    pub set_pages: Vec<usize>,
    /// Pages removing a password would have to change. Never written.
    pub remove_pages: Vec<usize>,
}

/// What the panel can report without a Tag in the field: no claim at all about
/// protection, and the pages an operation would touch if it were possible.
pub fn report_without_tag(why: &str) -> PasswordReport {
    PasswordReport {
        uid: None,
        capacity_bytes: None,
        protection: ProtectionStatus::Unknown,
        config: None,
        why_unknown: why.to_string(),
        set_pages: PasswordOperation::Set.config_pages(),
        remove_pages: PasswordOperation::Remove.config_pages(),
    }
}

pub fn report_from_image(uid: String, image: &MemoryImage) -> PasswordReport {
    let config = ConfigPages::from_image(image);
    PasswordReport {
        uid: Some(uid),
        capacity_bytes: image.user_capacity_bytes(),
        protection: protection_status(Some(&config)),
        config: Some(config),
        why_unknown: WHY_PROTECTION_UNKNOWN.to_string(),
        set_pages: PasswordOperation::Set.config_pages(),
        remove_pages: PasswordOperation::Remove.config_pages(),
    }
}

/// The one sentence about why protection cannot be determined, kept in one place
/// so the panel, the refusal and the docs cannot drift apart.
pub const WHY_PROTECTION_UNKNOWN: &str = "This Reader's report of the configuration area is \
     not the Tag's real configuration: AUTH0 reads 0x04 on every Tag, including Tags whose \
     user memory reads back in full, which a real AUTH0 of 4 would forbid. Whether the Tag is \
     password-protected therefore cannot be determined.";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ntag::{MemoryImage, PAGE_COUNT, PAGE_LEN};

    /// Build a memory image with chosen page contents. Everything not named is
    /// zero, mirroring a factory-blank Tag.
    fn image(pages: &[(usize, [u8; PAGE_LEN])]) -> MemoryImage {
        let mut payload = vec![0u8; 4];
        let mut data = vec![0u8; PAGE_COUNT * PAGE_LEN];
        for (page, bytes) in pages {
            data[page * PAGE_LEN..page * PAGE_LEN + PAGE_LEN].copy_from_slice(bytes);
        }
        payload.extend_from_slice(&data);
        payload.extend(std::iter::repeat_n(1u8, PAGE_COUNT));
        MemoryImage::from_read_payload(&payload).expect("a full 0x0081 payload parses")
    }

    /// The NTAG215 this project has written to, as it reads.
    fn nt215() -> MemoryImage {
        image(&[
            (0, [0x04, 0x43, 0x7B, 0xB4]),
            (3, [0xE1, 0x10, 0x3E, 0x00]),
            (AUTH0_PAGE, [0x04, 0x00, 0x00, 0xFF]),
            (PWD_PAGE, [0, 0, 0, 0]),
            (PACK_PAGE, [0, 0, 0, 0]),
        ])
    }

    fn acknowledged(operation: PasswordOperation, protection: ProtectionStatus) -> PasswordRequest {
        PasswordRequest {
            operation,
            acknowledged: true,
            protection,
        }
    }

    // -- the acknowledgement gate -----------------------------------------

    #[test]
    fn a_request_starts_unacknowledged_and_unknown() {
        let request = PasswordRequest::new(PasswordOperation::Set);
        assert!(!request.acknowledged, "there is no default-accepted request");
        assert_eq!(request.protection, ProtectionStatus::Unknown);
    }

    #[test]
    fn nothing_happens_without_an_explicit_acknowledgement() {
        for operation in [PasswordOperation::Set, PasswordOperation::Remove] {
            let request = PasswordRequest::new(operation);
            assert_eq!(
                decide(&request).unwrap_err(),
                PasswordRefusal::NotAcknowledged,
                "{operation:?} must be refused while unacknowledged"
            );
        }
    }

    #[test]
    fn the_acknowledgement_names_the_consequence() {
        let message = PasswordRefusal::NotAcknowledged.message();
        assert!(message.contains("permanently unrecoverable"), "{message}");
        assert!(message.contains("Nothing was written"), "{message}");
    }

    #[test]
    fn acknowledging_does_not_unlock_setting() {
        // Necessary but never sufficient: the same refusal a real request gets.
        assert_eq!(
            decide(&acknowledged(
                PasswordOperation::Set,
                ProtectionStatus::Unknown
            ))
            .unwrap_err(),
            PasswordRefusal::CannotAuthenticate
        );
    }

    // -- setting is refused, and says why ---------------------------------

    #[test]
    fn setting_is_refused_because_the_reader_cannot_authenticate() {
        const { assert!(!READER_CAN_AUTHENTICATE) };
        let refusal = decide(&acknowledged(
            PasswordOperation::Set,
            ProtectionStatus::Unknown,
        ))
        .unwrap_err();
        assert_eq!(refusal, PasswordRefusal::CannotAuthenticate);

        let message = refusal.message();
        assert!(message.contains("no command that authenticates"), "{message}");
        assert!(message.contains("one-way"), "{message}");
        assert!(message.contains("permanently unrecoverable"), "{message}");
    }

    #[test]
    fn setting_names_the_pages_it_would_have_written() {
        assert_eq!(
            PasswordOperation::Set.config_pages(),
            vec![AUTH0_PAGE, PWD_PAGE, PACK_PAGE]
        );
        assert_eq!(PasswordOperation::Remove.config_pages(), vec![AUTH0_PAGE]);
    }

    #[test]
    fn no_decision_can_ever_allow_a_password_operation() {
        // Every combination of operation, acknowledgement and protection state
        // is refused. The success type is `Infallible`, so this is the only
        // possible outcome — the assertion records it for a future change.
        let statuses = [
            ProtectionStatus::Unknown,
            ProtectionStatus::Disabled,
            ProtectionStatus::Enabled { auth0: 4 },
        ];
        for operation in [PasswordOperation::Set, PasswordOperation::Remove] {
            for ack in [false, true] {
                for protection in statuses {
                    let request = PasswordRequest {
                        operation,
                        acknowledged: ack,
                        protection,
                    };
                    assert!(
                        decide(&request).is_err(),
                        "{operation:?} ack={ack} {protection:?} must be refused"
                    );
                }
            }
        }
    }

    // -- removal ----------------------------------------------------------

    #[test]
    fn removal_is_refused_when_protection_cannot_be_determined() {
        let refusal = decide(&acknowledged(
            PasswordOperation::Remove,
            ProtectionStatus::Unknown,
        ))
        .unwrap_err();
        assert_eq!(refusal, PasswordRefusal::ProtectionUnknown);
    }

    #[test]
    fn an_unknown_password_is_never_presented_as_recoverable() {
        let refusal = PasswordRefusal::ProtectionUnknown.message();
        assert!(
            refusal.contains("never treated as recoverable"),
            "{refusal}"
        );
        assert!(refusal.contains("cannot be determined"), "{refusal}");
    }

    #[test]
    fn removal_of_a_protected_tag_is_refused_because_it_cannot_authenticate() {
        let refusal = decide(&acknowledged(
            PasswordOperation::Remove,
            ProtectionStatus::Enabled { auth0: 4 },
        ))
        .unwrap_err();
        assert_eq!(refusal, PasswordRefusal::CannotAuthenticate);
    }

    #[test]
    fn removal_of_an_unprotected_tag_has_nothing_to_remove() {
        let refusal = decide(&acknowledged(
            PasswordOperation::Remove,
            ProtectionStatus::Disabled,
        ))
        .unwrap_err();
        assert_eq!(refusal, PasswordRefusal::NothingToRemove);
        assert!(refusal.message().contains("nothing to remove"));
    }

    // -- configuration reads are not trusted ------------------------------

    #[test]
    fn the_readers_configuration_report_is_not_real_configuration() {
        const { assert!(!CONFIG_PAGES_ARE_REAL) };
        let config = ConfigPages::from_image(&nt215());
        assert!(!config.real_configuration);
        assert_eq!(config.auth0_page_read, Some([0x04, 0x00, 0x00, 0xFF]));
    }

    #[test]
    fn protection_cannot_be_determined_from_this_readers_config_read() {
        // The dump says AUTH0 = 0x04, which would protect page 4 onwards — and
        // page 4 of the very same dump read back fine. The contradiction is why
        // this must be Unknown rather than Enabled.
        let config = ConfigPages::from_image(&nt215());
        assert_eq!(
            protection_status(Some(&config)),
            ProtectionStatus::Unknown
        );
        assert!(!protection_status(Some(&config)).is_known());
    }

    #[test]
    fn a_real_configuration_read_would_be_classified_honestly() {
        // Not reachable on this Reader, but the classification is written down
        // so it cannot quietly claim protection is off for a protected Tag.
        let disabled = ConfigPages {
            auth0_page_read: Some([AUTH0_DISABLED, 0, 0, 0]),
            pwd_page_read: Some([0, 0, 0, 0]),
            pack_page_read: Some([0, 0, 0, 0]),
            real_configuration: true,
        };
        assert_eq!(
            protection_status(Some(&disabled)),
            ProtectionStatus::Disabled
        );

        let enabled = ConfigPages {
            auth0_page_read: Some([4, 0, 0, 0]),
            ..disabled
        };
        assert_eq!(
            protection_status(Some(&enabled)),
            ProtectionStatus::Enabled { auth0: 4 }
        );

        let missing = ConfigPages {
            auth0_page_read: None,
            ..enabled
        };
        assert_eq!(protection_status(Some(&missing)), ProtectionStatus::Unknown);
        assert_eq!(protection_status(None), ProtectionStatus::Unknown);
    }

    // -- the configuration-page guard -------------------------------------

    #[test]
    fn the_guard_refuses_every_page_a_password_operation_would_touch() {
        for operation in [PasswordOperation::Set, PasswordOperation::Remove] {
            for page in operation.config_pages() {
                assert_eq!(
                    guard_config_write(&[page]).unwrap_err(),
                    PasswordRefusal::ConfigPageWrite { page }
                );
            }
        }
    }

    #[test]
    fn the_guard_refuses_the_whole_configuration_area() {
        for page in CONFIG_FIRST_PAGE..=PAGE_COUNT - 1 {
            assert!(guard_config_write(&[page]).is_err(), "page {page}");
        }
        // ...and permits nothing that would be a user page on a real Tag.
        for page in 4..CONFIG_FIRST_PAGE {
            assert!(guard_config_write(&[page]).is_ok(), "page {page}");
        }
        assert!(guard_config_write(&[0, 1, 2, 3]).is_ok());
    }

    #[test]
    fn the_guard_names_the_page_it_refused() {
        let refusal = guard_config_write(&[4, PWD_PAGE]).unwrap_err();
        assert_eq!(refusal, PasswordRefusal::ConfigPageWrite { page: PWD_PAGE });
        let message = refusal.message();
        assert!(message.contains(&PWD_PAGE.to_string()), "{message}");
        assert!(message.contains("cannot undo"), "{message}");
    }

    #[test]
    fn a_report_without_a_tag_claims_nothing_about_the_tag() {
        let report = report_without_tag("no Tag in the field");
        assert!(report.uid.is_none());
        assert_eq!(report.protection, ProtectionStatus::Unknown);
        assert!(report.config.is_none());
        assert_eq!(report.set_pages, vec![AUTH0_PAGE, PWD_PAGE, PACK_PAGE]);
    }

    #[test]
    fn a_report_names_the_tag_and_keeps_protection_unknown() {
        let report = report_from_image("04 43 7B 01 CC 09 03".to_string(), &nt215());
        assert_eq!(report.uid.as_deref(), Some("04 43 7B 01 CC 09 03"));
        assert_eq!(report.capacity_bytes, Some(496));
        assert_eq!(report.protection, ProtectionStatus::Unknown);
        assert!(report.why_unknown.contains("AUTH0 reads 0x04"));
    }
}
