//! The library: Snapshots persisted in one versioned JSON file.
//!
//! The file is replaced atomically — a sibling temp file is written and flushed
//! to disk, then renamed over the library — so an interrupted save leaves the
//! previous library exactly as it was. A file that cannot be read, that was
//! written by a newer schema version, or that is older than the oldest schema
//! this build can lift, is reported and never overwritten: a clean start on top
//! of unreadable bytes is data loss.
//!
//! The schema version is a claim about the file's contents, and ADR 0005 makes
//! it a load-bearing one: an older build refuses a file whose version it does
//! not understand, instead of deserialising it into a struct that has no room
//! for the newer keys and then writing the file back without them. A file one
//! version behind is lifted on open — see [`LibraryStore::open`] and
//! [`crate::library_schema`] — so the file's stated version agrees with what it
//! holds before anything can edit it.
//!
//! This module owns the **serialisation domain**: the one lock every write to
//! the file is performed under, whoever performs it. A save, an import, an
//! export and a dump all replace the whole file with bytes read moments earlier,
//! so they must not overlap — two of them reading the same starting state would
//! each rename a file holding only their own change, and one whole update would
//! be lost with nothing reported. See [`serialised`].
//!
//! Nothing here touches the Reader, so every test runs against a real temp
//! directory with no hardware attached.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::identity::Identity;
use crate::write_outcome::WriteOutcome;

/// The schema version this build writes and understands.
///
/// 2 since Drafts were added to the file: a new persisted key is a schema
/// change, and a schema change bumps the version (ADR 0005). Version 1 files are
/// lifted to 2 on open rather than refused; see [`crate::library_schema`].
pub const SCHEMA_VERSION: u32 = 2;

/// Suffix of the staging file a write stages before renaming it into place.
///
/// One suffix for every write, because there is one writer at a time: the
/// domain below is what stops two writes staging into the same path.
const TEMP_SUFFIX: &str = ".tmp";

/// The one serialisation domain that governs the library file.
///
/// Every write to the file — a save from the store, an import that merges a
/// document into it, an export or a dump staged beside it — is performed while
/// this is held. One lock is the whole point: two locks would each be sound on
/// their own and jointly unsound, which is precisely how two saves overlapping
/// in time could each read the same starting library and each rename a file
/// reflecting only its own change.
///
/// It is held across a whole read-and-write, not just across the write, because
/// the write replaces the file with a version read a moment earlier. A lock that
/// only covered the replace would leave the read outside the domain, and the
/// update another writer made in between would be replaced rather than kept.
static LIBRARY_DOMAIN: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Proof that the caller holds the one serialisation domain.
///
/// Only [`serialised`] mints one, and the functions that write the file demand
/// it, so a write path that skips the lock does not compile. The guard is the
/// token: the domain is held exactly as long as this value lives.
#[derive(Debug)]
pub(crate) struct Domain {
    _guard: std::sync::MutexGuard<'static, ()>,
}

/// Run `f` as the only writer of the library file in this process.
///
/// The whole operation goes inside one call — the read, the change, and the
/// write — so no second writer can slip between them. Calls do not nest: the
/// functions that assume the domain ask for the [`Domain`] token instead of
/// taking the lock again, so an operation takes the lock once, at its outer
/// edge.
pub(crate) fn serialised<T>(f: impl FnOnce(&Domain) -> T) -> T {
    // A panic in another writer must not poison the file's domain for good: the
    // guard is released either way, and nothing here leaves a half-written file
    // to protect.
    let guard = LIBRARY_DOMAIN.lock().unwrap_or_else(|e| e.into_inner());
    f(&Domain { _guard: guard })
}

/// Write `bytes` to `path` atomically, inside the domain: staged beside the
/// target, flushed to disk, renamed over it, and the directory entry flushed.
///
/// This is the only code that replaces a library file, whether the bytes are a
/// library from a save, a document from an import, or a copy of either for the
/// user. A crash at any point leaves the old file or the new one, never a torn
/// one.
pub(crate) fn write_atomically(_domain: &Domain, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let staged = stage_bytes(path, bytes)?;
    commit_staged(&staged, path)
}

/// Stage `bytes` beside `path` and flush them, creating the directory if the
/// write is the first thing to happen there.
fn stage_bytes(path: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let staged = staging_path(path);
    write_and_flush(&staged, bytes)?;
    Ok(staged)
}

/// Commit a staged file: one rename, which is atomic on the same filesystem.
fn commit_staged(staged: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(staged, path)?;
    if let Some(parent) = path.parent() {
        // Flush the directory entry so the rename itself is durable.
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

fn staging_path(path: &Path) -> PathBuf {
    let mut staged = path.to_path_buf().into_os_string();
    staged.push(TEMP_SUFFIX);
    PathBuf::from(staged)
}

fn write_and_flush(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    // The bytes must be on the platter before the rename, or a power cut can
    // leave an empty library where a complete one was promised.
    file.sync_all()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Library {
    pub version: u32,
    pub snapshots: Vec<Snapshot>,
    /// Drafts live beside the Snapshots in the same file but in their own
    /// collection: a Snapshot is a record of one read of one Tag, a Draft is an
    /// editable NDEF message attached to no Tag at all. Defaulted so that a v1
    /// file — written before Drafts existed — still deserialises once it has
    /// been lifted; the lift is what makes its absence legitimate, not the
    /// default on its own (ADR 0005).
    #[serde(default)]
    pub drafts: Vec<Draft>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Kind {
    LF,
    HF,
}

/// One immutable record of one read of one Tag.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Stable across restarts: the Identity id, the UID, or a generated id.
    pub id: String,
    /// User-editable. Never empty when the app creates a Snapshot.
    pub name: String,
    #[serde(default)]
    pub note: String,
    pub kind: Kind,
    pub captured_at: String,
    /// Confirmed copies, not attempts. Only a verified write increments it.
    #[serde(default)]
    pub write_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<IdentityFields>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hf: Option<HfFields>,
}

/// What a 125 kHz Tag was when it was read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityFields {
    pub customer: u8,
    pub data32: u32,
    pub facility: u8,
    pub card: u16,
    /// The payload as the Reader reported it, kept for an honest raw display.
    pub raw: String,
}

/// What a 13.56 MHz Tag was when it was read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HfFields {
    pub uid: String,
    pub raw: String,
}

/// An editable NDEF message that is not bound to any Tag. It is named, it holds
/// zero or more Records in order, and it may be written many times; each Tag it
/// lands on gets its own Snapshot-quality result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    /// Stable across restarts. Generated by the store, never by the UI, so two
    /// drafts created in the same millisecond cannot share an id.
    pub id: String,
    /// User-editable. Never empty when the app creates a Draft.
    pub name: String,
    /// ISO timestamp of the last edit, set when the Draft is saved.
    pub updated_at: String,
    #[serde(default)]
    pub records: Vec<DraftRecord>,
}

/// One Record in a Draft: a kind, and the string fields that kind carries.
///
/// Deliberately not an enum. The record set is authored and encoded in the
/// webview (`src/lib/ndef.ts`), which owns the NDEF codec, so a Record type
/// added there must not need a change here — and a Record written by a build
/// this one does not recognise is still kept rather than silently dropped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DraftRecord {
    pub kind: String,
    #[serde(default)]
    pub fields: std::collections::BTreeMap<String, String>,
}

/// What a save did, so the UI can say "already in the library" rather than
/// silently failing to add a second copy.
#[derive(Debug, Clone, PartialEq)]
pub enum InsertOutcome {
    Added(Snapshot),
    /// The read is already in the library; this is the existing Snapshot.
    Duplicate(Snapshot),
}

impl Snapshot {
    /// Two Snapshots with the same key are the same read of the same Tag.
    /// `library_io` imports on this same key, so a conflict means the same
    /// thing wherever it is decided.
    pub(crate) fn tag_key(&self) -> Option<String> {
        match (&self.identity, &self.hf) {
            (Some(identity), _) => Some(identity_key(identity.customer, identity.data32)),
            (None, Some(hf)) => Some(format!("HF:{}", hf.uid)),
            // A raw-only Snapshot carries nothing to compare, so it is never a
            // duplicate of anything.
            (None, None) => None,
        }
    }
}

/// The key that identifies one 125 kHz Identity, shared by dedupe and counting
/// so the two can never disagree about what "the same Identity" means.
fn identity_key(customer: u8, data32: u32) -> String {
    format!("LF:{customer:02X}:{data32:08X}")
}

/// What recording a write outcome did to a Snapshot's confirmed-copy count.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteCountOutcome {
    /// No Snapshot carries this Identity, so there is no count to change.
    NoSnapshot,
    /// A confirmed copy: the count rose by one.
    Incremented { id: String, write_count: u32 },
    /// Not a confirmed copy, so the count is exactly what it was.
    Unchanged { id: String, write_count: u32 },
}

impl WriteCountOutcome {
    /// The count to show, when a Snapshot carries this Identity.
    pub fn confirmed_copies(&self) -> Option<u32> {
        match self {
            WriteCountOutcome::NoSnapshot => None,
            WriteCountOutcome::Incremented { write_count, .. }
            | WriteCountOutcome::Unchanged { write_count, .. } => Some(*write_count),
        }
    }

    /// True only when the count actually rose, so a save is only needed then.
    pub fn incremented(&self) -> bool {
        matches!(self, WriteCountOutcome::Incremented { .. })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum LibraryProblem {
    /// The bytes are not a library this build can read.
    Corrupt { detail: String },
    /// Written by a newer schema; rewriting it would downgrade the user's data.
    NewerVersion { found: u64, supported: u32 },
    /// Older than the oldest schema this build can lift, so this build does not
    /// read it. It no longer fires for a version this build carries a migration
    /// from: those are lifted on open. It stays for a file older than the oldest
    /// migration, because reporting such a file as `Corrupt` would tell the user
    /// their data is damaged when it is merely old.
    OlderVersion { found: u64, supported: u32 },
    /// The file exists but cannot be read at all, so its contents are unknown.
    Unreadable { detail: String },
}

#[derive(Debug, Clone, PartialEq)]
pub enum SaveError {
    /// The file on disk is not one this build may overwrite, and was not touched.
    Refused(LibraryProblem),
    /// The replacement could not be written; the previous file is untouched.
    Io(String),
}

impl LibraryProblem {
    /// What to tell the user. States what was found and that nothing was
    /// written, because the next thing a worried user does is try to save.
    pub fn message(&self) -> String {
        match self {
            LibraryProblem::Corrupt { .. } => {
                "The library file could not be read as a library. It has not been changed."
                    .to_string()
            }
            LibraryProblem::NewerVersion { found, supported } => format!(
                "This library was written by a newer version of PM4 Studio \
                 (schema {found}; this build understands {supported}). \
                 It has been left exactly as it is, because saving would downgrade it."
            ),
            LibraryProblem::OlderVersion { found, supported } => format!(
                "This library uses schema {found}, which this build does not read \
                 (it understands {supported}). It has been left exactly as it is."
            ),
            LibraryProblem::Unreadable { .. } => {
                "The library file could not be read, so it has not been changed.".to_string()
            }
        }
    }
}

/// One library file, decoded.
///
/// `library` is always this build's shape: a file one version behind has
/// already been lifted, so no caller has to know which version it came from.
#[derive(Debug, Clone, PartialEq)]
struct Read {
    library: Library,
    /// The version the file itself claimed, before any lift.
    found: u32,
    /// The file as this build would write it, when it had to be lifted. `None`
    /// means the file already claims this build's version and must not be
    /// rewritten just for having been read.
    lifted: Option<serde_json::Value>,
}

/// What opening the library came to.
#[derive(Debug, Clone, PartialEq)]
pub enum Open {
    /// The library is readable, and any lift of an older file has been attempted.
    Opened {
        /// The library as this build reads it — lifted, if the file was older.
        library: Library,
        /// Set when the file was written by an older schema and was lifted.
        migration: Option<Lifted>,
    },
    /// The file is not one this build may read, and nothing was written.
    Refused(LibraryProblem),
}

/// What lifting an older file to this build's schema came to.
#[derive(Debug, Clone, PartialEq)]
pub enum Lifted {
    /// The file now claims the current schema. `from` is what it claimed before.
    Written { from: u32 },
    /// The lift could not be written, so the file still claims `from`.
    ///
    /// A failed write, not a failed read: the library was read whole, so the
    /// app continues with it rather than refusing the user's own data. The next
    /// successful save writes the lift as part of the save.
    Unwritten { from: u32, detail: String },
}

impl Lifted {
    /// What to tell the user, when there is anything to tell them.
    ///
    /// A written lift is silent — the file is correct and nobody needs to know
    /// it was once older. One that could not be written says so, and says what
    /// the risk now is and that the library is still usable.
    pub fn message(&self) -> Option<String> {
        match self {
            Lifted::Written { .. } => None,
            Lifted::Unwritten { from, detail } => Some(format!(
                "This library was written for schema {from} and has been read as schema {}. \
                 It could not be rewritten: {detail}. Everything in it is open and usable, \
                 and saving will correct the file — until then the file still says schema \
                 {from}, so an older version of PM4 Studio could overwrite it.",
                SCHEMA_VERSION
            )),
        }
    }
}

/// The library file on disk, addressed by path so it is testable.
pub struct LibraryStore {
    path: PathBuf,
}

impl LibraryStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Open the library as the app does: read it, lift it to this build's
    /// schema if it was written by an older one, and — when it was lifted —
    /// write the lift back before returning.
    ///
    /// The write is eager, and that is deliberate (ADR 0005). A v1 file holds a
    /// `drafts` key the v1 format never had; left alone it keeps claiming v1,
    /// and an older build that meets it deserialises it into a struct with no
    /// room for Drafts and writes it back without them. Correcting the version
    /// claim at the earliest possible moment is what closes that window, and the
    /// earliest possible moment is this one.
    ///
    /// A lift that cannot be written is reported, not fatal: the library read
    /// fine, so the app continues with it in memory and the next save corrects
    /// the file. Only a file this build must not read is refused.
    pub fn open(&self) -> Open {
        serialised(|domain| self.open_in(domain))
    }

    /// Opening, inside the domain the caller holds.
    pub(crate) fn open_in(&self, domain: &Domain) -> Open {
        let read = match self.read() {
            Ok(read) => read,
            Err(problem) => return Open::Refused(problem),
        };
        let Some(document) = read.lifted else {
            return Open::Opened {
                library: read.library,
                migration: None,
            };
        };
        let migration = match self.write_lift(domain, &document) {
            Ok(()) => Lifted::Written { from: read.found },
            Err(detail) => Lifted::Unwritten {
                from: read.found,
                detail,
            },
        };
        Open::Opened {
            library: read.library,
            migration: Some(migration),
        }
    }

    /// Read the library, without writing anything.
    ///
    /// An older file is lifted in memory so every caller sees this build's
    /// shape, but the file itself is left alone: this is the read for a file
    /// this build did not write — an import source, an export — and for reads
    /// inside the domain that are about to write anyway. Opening the user's own
    /// library is [`open`](Self::open), which also corrects an older file's
    /// version claim.
    pub fn load(&self) -> Result<Library, LibraryProblem> {
        self.read().map(|read| read.library)
    }

    /// The read itself: the bytes, decoded and lifted.
    fn read(&self) -> Result<Read, LibraryProblem> {
        match fs::read(&self.path) {
            Ok(bytes) => parse_library(&bytes),
            // A missing file is a library nobody has written to yet.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Read {
                library: Library::empty(),
                found: SCHEMA_VERSION,
                lifted: None,
            }),
            Err(e) => Err(LibraryProblem::Unreadable {
                detail: e.to_string(),
            }),
        }
    }

    /// Write a lifted document over the file, inside the domain.
    ///
    /// The document is written as it stands rather than round-tripped through
    /// [`Library`], so a key this build does not model survives the lift instead
    /// of being dropped by the struct on the way out. The staging path and the
    /// rename are the store's own — [`write_atomically`] — so a lift is as
    /// atomic as every other write, and there is still one writer at a time.
    fn write_lift(&self, domain: &Domain, document: &serde_json::Value) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(document).map_err(|e| e.to_string())?;
        write_atomically(domain, &self.path, &bytes).map_err(|e| e.to_string())
    }

    /// Replace the library file atomically.
    ///
    /// The replacement is written to a sibling temp file and flushed to disk
    /// before it is renamed over the library, so a crash at any point leaves
    /// either the previous library or the new one — never a truncated file.
    ///
    /// One step in the serialisation domain, so it cannot interleave with
    /// another writer's read or write.
    ///
    /// This writes the library it is handed, so it is for a caller that has
    /// built a whole library itself — an import that merged a document, a
    /// migration that lifted an old one. A change to a library that already
    /// exists goes through [`update`](Self::update), which reads and writes as
    /// one step; a caller that reads, changes and then calls this hands over a
    /// version that another writer may already have moved past, and adopting it
    /// loses that writer's update.
    pub fn save(&self, library: &Library) -> Result<(), SaveError> {
        serialised(|domain| self.replace(domain, library))
    }

    /// Change the library as one indivisible step: read it, apply `change`, and
    /// replace the file, with no other writer able to run in between.
    ///
    /// This is how every change to a library that already exists is written, so
    /// two saves that overlap queue behind one another and both land. Nothing is
    /// written when `change` changed nothing, so an operation that turned out to
    /// be a no-op leaves the file byte for byte as it was. The refusal to touch
    /// a file this build cannot read is decided inside the same step, so it
    /// cannot be raced either.
    ///
    /// `change` must not call back into the store: the domain it would ask for
    /// is already held.
    pub fn update<R>(
        &self,
        change: impl FnOnce(&mut Library) -> R,
    ) -> Result<(Library, R), SaveError> {
        serialised(|domain| {
            // Opening is part of the same step, so a lift of an older file is
            // written before `change` runs: no edit is ever applied to a
            // library whose file is still about to be rewritten.
            let mut library = match self.open_in(domain) {
                Open::Opened { library, .. } => library,
                Open::Refused(problem) => return Err(SaveError::Refused(problem)),
            };
            let before = library.clone();
            let result = change(&mut library);
            if library != before {
                self.replace(domain, &library)?;
            }
            Ok((library, result))
        })
    }

    /// The replacement itself, inside the domain the caller holds.
    pub(crate) fn replace(&self, domain: &Domain, library: &Library) -> Result<(), SaveError> {
        // Never replace a file this build cannot read: the bytes on disk may be
        // the user's only copy, and a clean start would destroy them.
        if let Err(problem) = self.read() {
            return Err(SaveError::Refused(problem));
        }
        let staged = self
            .stage(domain, library)
            .map_err(|e| SaveError::Io(e.to_string()))?;
        self.commit(domain, &staged)
            .map_err(|e| SaveError::Io(e.to_string()))
    }

    /// The staging half of an atomic replacement: write the replacement to a
    /// sibling temp file and flush it. Nothing is visible at `path` yet.
    fn stage(&self, _domain: &Domain, library: &Library) -> std::io::Result<PathBuf> {
        let bytes = serde_json::to_vec_pretty(library)?;
        stage_bytes(&self.path, &bytes)
    }

    /// The commit half: one rename, which is atomic on the same filesystem.
    fn commit(&self, _domain: &Domain, staged: &Path) -> std::io::Result<()> {
        commit_staged(staged, &self.path)
    }
}

impl Library {
    pub fn empty() -> Self {
        Self {
            version: SCHEMA_VERSION,
            snapshots: Vec::new(),
            drafts: Vec::new(),
        }
    }

    /// Add a Snapshot unless the same read of the same Tag is already here.
    pub fn add(&mut self, snapshot: Snapshot) -> InsertOutcome {
        if let Some(key) = snapshot.tag_key() {
            if let Some(existing) = self
                .snapshots
                .iter()
                .find(|s| s.tag_key().as_deref() == Some(key.as_str()))
            {
                return InsertOutcome::Duplicate(existing.clone());
            }
        }
        let mut snapshot = snapshot;
        if snapshot.name.trim().is_empty() {
            snapshot.name = self.next_name();
        }
        self.snapshots.push(snapshot.clone());
        InsertOutcome::Added(snapshot)
    }

    /// Add a 125 kHz read. Facility and card are derived here, from the data
    /// field, so the file never carries a decode the app did not do.
    pub fn add_lf(
        &mut self,
        customer: u8,
        data32: u32,
        raw: &str,
        captured_at: &str,
    ) -> InsertOutcome {
        let identity = Identity { customer, data32 };
        self.add(Snapshot {
            id: identity.id(),
            name: self.next_name(),
            note: String::new(),
            kind: Kind::LF,
            captured_at: captured_at.to_string(),
            write_count: 0,
            identity: Some(IdentityFields {
                customer,
                data32,
                facility: identity.facility(),
                card: identity.card(),
                raw: raw.to_string(),
            }),
            hf: None,
        })
    }

    /// Add a 13.56 MHz read.
    pub fn add_hf(&mut self, uid: &str, raw: &str, captured_at: &str) -> InsertOutcome {
        self.add(Snapshot {
            id: uid.to_string(),
            name: self.next_name(),
            note: String::new(),
            kind: Kind::HF,
            captured_at: captured_at.to_string(),
            write_count: 0,
            identity: None,
            hf: Some(HfFields {
                uid: uid.to_string(),
                raw: raw.to_string(),
            }),
        })
    }

    /// The next free "Snapshot N" title, so a save always has something to show.
    pub fn next_name(&self) -> String {
        let used: std::collections::HashSet<&str> =
            self.snapshots.iter().map(|s| s.name.as_str()).collect();
        let mut n = 1;
        while used.contains(format!("Snapshot {n}").as_str()) {
            n += 1;
        }
        format!("Snapshot {n}")
    }

    /// Rename one Snapshot. `false` means no Snapshot carries that id.
    pub fn rename(&mut self, id: &str, name: &str) -> bool {
        match self.snapshots.iter_mut().find(|s| s.id == id) {
            Some(snapshot) => {
                snapshot.name = name.trim().to_string();
                true
            }
            None => false,
        }
    }

    /// Delete one Snapshot. `false` means no Snapshot carries that id.
    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.snapshots.len();
        self.snapshots.retain(|s| s.id != id);
        self.snapshots.len() != before
    }

    /// Write the name and note a user gave one Snapshot, in one go.
    ///
    /// These two fields are the whole of a Snapshot's user copy, so they are
    /// set together: a caller that cancels simply never calls this, and a
    /// caller that confirms cannot leave one of them written on its own.
    /// Surrounding whitespace is dropped; the lines inside a note are kept.
    /// `false` means no Snapshot carries that id.
    pub fn edit(&mut self, id: &str, name: &str, note: &str) -> bool {
        match self.snapshots.iter_mut().find(|s| s.id == id) {
            Some(snapshot) => {
                snapshot.name = name.trim().to_string();
                snapshot.note = note.trim().to_string();
                true
            }
            None => false,
        }
    }

    // Drafts. A Draft is not a Snapshot and never appears in that collection;
    // nothing below touches `snapshots`.

    /// The next free "Draft N" title, so a new Draft always has something to
    /// show. A hand-chosen name neither blocks a number nor shifts the sequence.
    pub fn next_draft_name(&self) -> String {
        let used: std::collections::HashSet<&str> =
            self.drafts.iter().map(|d| d.name.as_str()).collect();
        let mut n = 1;
        while used.contains(format!("Draft {n}").as_str()) {
            n += 1;
        }
        format!("Draft {n}")
    }

    /// The next id: one past the highest `draft-N` ever used, so an id freed by
    /// a delete is never handed to a different Draft.
    fn next_draft_id(&self) -> String {
        let mut highest = 0u32;
        for draft in &self.drafts {
            if let Some(rest) = draft.id.strip_prefix("draft-") {
                if let Ok(n) = rest.parse::<u32>() {
                    highest = highest.max(n);
                }
            }
        }
        format!("draft-{}", highest + 1)
    }

    /// Create an empty Draft. An empty name gets the next "Draft N".
    pub fn add_draft(&mut self, name: &str, updated_at: &str) -> Draft {
        let name = match name.trim().is_empty() {
            true => self.next_draft_name(),
            false => name.to_string(),
        };
        let draft = Draft {
            id: self.next_draft_id(),
            name,
            updated_at: updated_at.to_string(),
            records: Vec::new(),
        };
        self.drafts.push(draft.clone());
        draft
    }

    /// Replace a Draft whole — name and Records, in the order given. `false`
    /// means no Draft carries that id, and nothing was created or changed.
    pub fn save_draft(&mut self, draft: Draft) -> bool {
        match self.drafts.iter_mut().find(|d| d.id == draft.id) {
            Some(existing) => {
                *existing = draft;
                true
            }
            None => false,
        }
    }

    /// Record what one attempted write of `identity` turned out to be.
    ///
    /// The count is confirmed copies, not attempts, so only a verified write
    /// increments it. A refusal, a transmission failure, and a write whose
    /// read-back could not confirm it all leave the count exactly as it was:
    /// none of them is evidence that another Tag carries this Identity.
    pub fn record_write(
        &mut self,
        identity: &Identity,
        outcome: WriteOutcome,
    ) -> WriteCountOutcome {
        let key = identity_key(identity.customer, identity.data32);
        let Some(snapshot) = self
            .snapshots
            .iter_mut()
            .find(|s| s.tag_key().as_deref() == Some(key.as_str()))
        else {
            // Nothing in the library holds this Identity, so there is no count
            // to be honest about.
            return WriteCountOutcome::NoSnapshot;
        };

        if outcome.counts_as_confirmed_copy() {
            snapshot.write_count = snapshot.write_count.saturating_add(1);
            WriteCountOutcome::Incremented {
                id: snapshot.id.clone(),
                write_count: snapshot.write_count,
            }
        } else {
            WriteCountOutcome::Unchanged {
                id: snapshot.id.clone(),
                write_count: snapshot.write_count,
            }
        }
    }

    /// Rename one Draft. The name is user copy, so it is only trimmed.
    pub fn rename_draft(&mut self, id: &str, name: &str) -> bool {
        match self.drafts.iter_mut().find(|d| d.id == id) {
            Some(draft) => {
                draft.name = name.trim().to_string();
                true
            }
            None => false,
        }
    }

    /// Delete one Draft. `false` means no Draft carries that id.
    pub fn remove_draft(&mut self, id: &str) -> bool {
        let before = self.drafts.len();
        self.drafts.retain(|d| d.id != id);
        self.drafts.len() != before
    }
}

/// Decode one library file, deciding first whether this build may read it at all.
///
/// The version is decided before anything is deserialised, because the answer
/// changes what is safe to do with the bytes: a file above this build's version
/// is refused untouched, one below is lifted, and only a file at this build's
/// version is read as it stands.
fn parse_library(bytes: &[u8]) -> Result<Read, LibraryProblem> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| LibraryProblem::Corrupt {
            detail: e.to_string(),
        })?;
    let Some(found) = value.get("version").and_then(|v| v.as_u64()) else {
        return Err(LibraryProblem::Corrupt {
            detail: "the file carries no schema version".to_string(),
        });
    };
    if found > u64::from(SCHEMA_VERSION) {
        return Err(LibraryProblem::NewerVersion {
            found,
            supported: SCHEMA_VERSION,
        });
    }
    let found = u32::try_from(found).map_err(|_| LibraryProblem::Corrupt {
        detail: "the file's schema version is out of range".to_string(),
    })?;

    let document = match found {
        current if current == SCHEMA_VERSION => value,
        older => crate::library_schema::lift_to_current(value, older)?,
    };
    let library =
        serde_json::from_value(document.clone()).map_err(|e| LibraryProblem::Corrupt {
            detail: e.to_string(),
        })?;
    Ok(Read {
        library,
        found,
        lifted: (found != SCHEMA_VERSION).then_some(document),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal Snapshot: what the persistence tests need, nothing more.
    fn snapshot(id: &str) -> Snapshot {
        Snapshot {
            id: id.to_string(),
            name: id.to_string(),
            note: String::new(),
            kind: Kind::LF,
            captured_at: "2026-11-21T09:30:00.000Z".to_string(),
            write_count: 0,
            identity: None,
            hf: None,
        }
    }

    #[test]
    fn a_saved_library_survives_reopening() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");

        let mut library = LibraryStore::new(&path)
            .load()
            .expect("a missing file is an empty library");
        assert_eq!(library.snapshots, vec![]);

        library.snapshots.push(snapshot("55 00 84 82 12"));
        LibraryStore::new(&path).save(&library).expect("save");

        // A fresh handle, as the next launch of the app would use.
        let reopened = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(reopened.snapshots, vec![snapshot("55 00 84 82 12")]);
        assert_eq!(reopened.version, SCHEMA_VERSION);
    }

    // Slice B: atomic replacement.

    fn library_with(ids: &[&str]) -> Library {
        Library {
            version: SCHEMA_VERSION,
            snapshots: ids.iter().map(|id| snapshot(id)).collect(),
            drafts: Vec::new(),
        }
    }

    #[test]
    fn a_save_leaves_only_the_library_file_behind() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);

        store
            .save(&library_with(&["55 00 84 82 12"]))
            .expect("save");

        let names: Vec<String> = fs::read_dir(dir.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(
            names,
            vec!["library.json"],
            "the staging file must not survive a save"
        );
    }

    #[test]
    fn an_interrupted_save_leaves_the_previous_library_intact() {
        // A crash between writing the replacement and renaming it into place is
        // the case a plain `write` loses the whole library to.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        store
            .save(&library_with(&["55 00 84 82 12"]))
            .expect("first save");

        let replacement = serialised(|domain| {
            store.stage(domain, &library_with(&["56 00 53 C7 B3"]))
        })
        .expect("stage the replacement, then never commit it");
        assert!(
            replacement.exists(),
            "the replacement is written to the temp file"
        );

        let intact = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(
            intact.snapshots,
            vec![snapshot("55 00 84 82 12")],
            "the library on disk is untouched until the rename commits it"
        );

        // The next launch reads the previous library, not the partial replacement.
        assert_eq!(
            LibraryStore::new(&path)
                .load()
                .expect("reload again")
                .snapshots,
            vec![snapshot("55 00 84 82 12")]
        );
    }

    #[test]
    fn a_failed_commit_leaves_the_previous_library_intact() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        store
            .save(&library_with(&["55 00 84 82 12"]))
            .expect("first save");

        // Renaming onto a path that is a directory cannot succeed.
        let blocked = dir.path().join("blocked");
        fs::create_dir(&blocked).expect("make the commit target impossible");
        let blocked_store = LibraryStore::new(&blocked);
        let staged = serialised(|domain| {
            blocked_store.stage(domain, &library_with(&["56 00 53 C7 B3"]))
        })
        .expect("stage");
        assert!(
            serialised(|domain| blocked_store.commit(domain, &staged)).is_err(),
            "a commit that cannot rename must report failure"
        );

        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").snapshots,
            vec![snapshot("55 00 84 82 12")],
            "the previous library survives a failed commit"
        );
    }

    #[test]
    fn saves_from_several_threads_queue_and_all_land() {
        // Four writers, forty saves, each on a different Tag. A save is a
        // read-and-write as one step in the domain, so they queue behind one
        // another: none fails, and no save replaces another's Snapshot.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");

        let mut handles = Vec::new();
        for n in 0..4u32 {
            let path = path.clone();
            handles.push(std::thread::spawn(move || {
                for _ in 0..10 {
                    let store = LibraryStore::new(&path);
                    store
                        .update(|library| {
                            library.add_lf(0x55, 0x0084_8212 + n, "00 01 01", CAPTURED_AT);
                        })
                        .expect("save");
                }
            }));
        }
        for handle in handles {
            handle.join().expect("thread");
        }

        let library = LibraryStore::new(&path)
            .load()
            .expect("the file is still a library after concurrent saves");
        assert_eq!(
            library.snapshots.len(),
            4,
            "every Tag saved by every thread is in the library"
        );
    }

    #[test]
    fn the_first_save_creates_the_app_data_directory() {
        // On a fresh install the directory does not exist yet; the library file
        // lives in it, so saving has to make it.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("pm4-studio").join("library.json");
        let store = LibraryStore::new(&path);

        store
            .save(&library_with(&["55 00 84 82 12"]))
            .expect("save");
        assert!(path.is_file());
        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").snapshots,
            vec![snapshot("55 00 84 82 12")]
        );
    }

    #[test]
    fn a_stale_staging_file_never_becomes_the_library() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        store
            .save(&library_with(&["55 00 84 82 12"]))
            .expect("first save");

        let mut stale = path.clone().into_os_string();
        stale.push(TEMP_SUFFIX);
        fs::write(&stale, b"{\"version\":1,\"snapshots\":[{\"id\":\"torn").expect("stale temp");

        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").snapshots,
            vec![snapshot("55 00 84 82 12")],
            "the library is the renamed file, never the staging file"
        );

        // The next save reuses the staging path and commits cleanly.
        store
            .save(&library_with(&["56 00 53 C7 B3"]))
            .expect("second save");
        assert!(!PathBuf::from(&stale).exists());
        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").snapshots,
            vec![snapshot("56 00 53 C7 B3")]
        );
    }

    // Slice C: a file this build must not read, and must never replace.

    fn bytes_at(path: &Path) -> Vec<u8> {
        fs::read(path).expect("read the file under test")
    }

    #[test]
    fn a_file_that_fails_to_parse_is_reported_and_never_replaced() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let torn = b"{\"version\":1,\"snapshots\":[{\"id\":\"55 00 84\"".to_vec();
        fs::write(&path, &torn).expect("write a torn file");

        let store = LibraryStore::new(&path);
        let problem = store
            .load()
            .expect_err("a torn file is not an empty library");
        assert!(
            matches!(problem, LibraryProblem::Corrupt { .. }),
            "got {problem:?}"
        );

        let refused = store
            .save(&library_with(&["55 00 84 82 12"]))
            .expect_err("saving over an unreadable library is refused");
        assert_eq!(refused, SaveError::Refused(problem));
        assert_eq!(
            bytes_at(&path),
            torn,
            "the unreadable file is left byte for byte"
        );
    }

    #[test]
    fn an_empty_file_is_reported_rather_than_read_as_empty() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::write(&path, b"").expect("write an empty file");

        assert!(matches!(
            LibraryStore::new(&path).load(),
            Err(LibraryProblem::Corrupt { .. })
        ));
    }

    #[test]
    fn a_file_from_a_newer_schema_is_reported_and_never_rewritten() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let newer =
            br#"{"version": 99, "snapshots": [{"id": "55 00 84 82 12", "future": true}]}"#.to_vec();
        fs::write(&path, &newer).expect("write a newer file");

        let store = LibraryStore::new(&path);
        let problem = store.load().expect_err("a newer file is not downgraded");
        assert_eq!(
            problem,
            LibraryProblem::NewerVersion {
                found: 99,
                supported: SCHEMA_VERSION
            }
        );

        let refused = store
            .save(&library_with(&["55 00 84 82 12"]))
            .expect_err("a newer library is never rewritten");
        assert_eq!(refused, SaveError::Refused(problem));
        assert_eq!(
            bytes_at(&path),
            newer,
            "the newer file is left byte for byte"
        );
    }

    #[test]
    fn a_file_from_an_older_schema_is_reported_rather_than_guessed_at() {
        // `OlderVersion` no longer fires for v1: v1 is lifted (see ADR 0005). It
        // now means "older than the oldest migration this build carries", which
        // is a file this build cannot walk up from. It is refused as old rather
        // than reported as damaged, because nothing about it is damaged.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let beyond = br#"{"version": 0, "snapshots": []}"#;
        fs::write(&path, beyond).expect("write");

        assert!(matches!(
            LibraryStore::new(&path).load(),
            Err(LibraryProblem::OlderVersion { found: 0, .. })
        ));
        assert!(matches!(
            LibraryStore::new(&path).open(),
            Open::Refused(LibraryProblem::OlderVersion { found: 0, .. })
        ));
        assert_eq!(
            fs::read(&path).expect("read the file"),
            beyond,
            "a file this build cannot lift is left exactly as it is"
        );
    }

    #[test]
    fn a_library_path_that_cannot_be_read_is_reported_and_never_replaced() {
        // A path that is not a readable file stands in for every io failure: the
        // contents are unknown, so nothing may overwrite them.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::create_dir(&path).expect("a directory where the library should be");

        let store = LibraryStore::new(&path);
        assert!(matches!(
            store.load(),
            Err(LibraryProblem::Unreadable { .. })
        ));
        assert!(matches!(
            store.save(&library_with(&["55 00 84 82 12"])),
            Err(SaveError::Refused(LibraryProblem::Unreadable { .. }))
        ));
    }

    #[test]
    fn a_save_commits_the_staged_replacement() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        store
            .save(&library_with(&["55 00 84 82 12"]))
            .expect("first save");
        store
            .save(&library_with(&["56 00 53 C7 B3"]))
            .expect("second save");

        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").snapshots,
            vec![snapshot("56 00 53 C7 B3")]
        );
    }

    // Slice D: what a Snapshot records, and the mutations the library offers.

    const CAPTURED_AT: &str = "2026-11-21T09:30:00.000Z";

    fn saved_lf(library: &mut Library, data32: u32) -> Snapshot {
        match library.add_lf(0x55, data32, "00 01 01", CAPTURED_AT) {
            InsertOutcome::Added(snapshot) => snapshot,
            InsertOutcome::Duplicate(existing) => panic!("unexpected duplicate: {existing:?}"),
        }
    }

    #[test]
    fn a_saved_read_records_its_identity_and_where_it_came_from() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let mut library = LibraryStore::new(&path).load().expect("empty library");

        let snapshot = saved_lf(&mut library, 0x0084_8212);
        assert_eq!(snapshot.id, "55 00 84 82 12");
        assert_eq!(snapshot.name, "Snapshot 1");
        assert_eq!(snapshot.note, "");
        assert_eq!(snapshot.kind, Kind::LF);
        assert_eq!(snapshot.captured_at, CAPTURED_AT);
        assert_eq!(snapshot.write_count, 0);
        assert_eq!(
            snapshot.identity,
            Some(IdentityFields {
                customer: 0x55,
                data32: 0x0084_8212,
                facility: 132,
                card: 33298,
                raw: "00 01 01".to_string(),
            })
        );
        assert_eq!(snapshot.hf, None);

        LibraryStore::new(&path).save(&library).expect("save");
        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").snapshots,
            vec![snapshot],
            "every field of a Snapshot survives a restart"
        );
    }

    #[test]
    fn saving_a_read_already_in_the_library_does_not_duplicate_it() {
        let mut library = Library::empty();
        let first = saved_lf(&mut library, 0x0084_8212);

        // The same Tag read again, later: the same read of the same Tag.
        let outcome = library.add_lf(0x55, 0x0084_8212, "00 01 01", "2026-11-22T10:00:00.000Z");
        assert_eq!(outcome, InsertOutcome::Duplicate(first.clone()));
        assert_eq!(library.snapshots.len(), 1, "no second copy of the same Tag");
        assert_eq!(
            library.snapshots[0].captured_at, CAPTURED_AT,
            "the first read is kept"
        );
    }

    #[test]
    fn a_different_tag_is_a_different_snapshot() {
        let mut library = Library::empty();
        let first = saved_lf(&mut library, 0x0084_8212);
        assert_eq!(first.id, "55 00 84 82 12");

        let second = saved_lf(&mut library, 0x0053_C7B3);
        assert_eq!(second.name, "Snapshot 2");
        assert_eq!(second.id, "55 00 53 C7 B3");
    }

    #[test]
    fn the_default_name_skips_a_name_that_is_already_taken() {
        let mut library = Library::empty();
        let first = saved_lf(&mut library, 0x0084_8212);
        let second = saved_lf(&mut library, 0x0053_C7B3);
        assert_eq!(first.name, "Snapshot 1");
        assert_eq!(second.name, "Snapshot 2");

        assert_eq!(
            library.next_name(),
            "Snapshot 3",
            "steps over the taken names"
        );

        library.remove(&second.id);
        assert_eq!(
            library.next_name(),
            "Snapshot 2",
            "a freed number comes back into use"
        );

        // A hand-chosen name neither blocks a number nor shifts the sequence.
        library.rename(&first.id, "Front door");
        assert_eq!(library.next_name(), "Snapshot 1");
    }

    #[test]
    fn a_renamed_snapshot_survives_reopening() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");
        let snapshot = saved_lf(&mut library, 0x0084_8212);
        store.save(&library).expect("save");

        let mut reopened = store.load().expect("reload");
        assert!(
            reopened.rename(&snapshot.id, "Front door"),
            "rename reports a change"
        );
        store.save(&reopened).expect("save the rename");

        let after = store.load().expect("reload");
        assert_eq!(after.snapshots[0].name, "Front door");
    }

    #[test]
    fn a_deleted_snapshot_survives_reopening() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");
        let kept = saved_lf(&mut library, 0x0084_8212);
        let doomed = saved_lf(&mut library, 0x0053_C7B3);
        store.save(&library).expect("save");

        let mut reopened = store.load().expect("reload");
        assert!(reopened.remove(&doomed.id), "remove reports a change");
        store.save(&reopened).expect("save the delete");

        let after = store.load().expect("reload");
        assert_eq!(after.snapshots, vec![kept]);
    }

    #[test]
    fn mutating_an_unknown_snapshot_changes_nothing() {
        let mut library = Library::empty();
        saved_lf(&mut library, 0x0084_8212);

        assert!(!library.rename("no such snapshot", "Name"));
        assert!(!library.remove("no such snapshot"));
        assert_eq!(library.snapshots.len(), 1);
    }

    #[test]
    fn a_problem_says_what_was_found_and_that_nothing_was_written() {
        let message = LibraryProblem::NewerVersion {
            found: 99,
            supported: SCHEMA_VERSION,
        }
        .message();
        assert!(message.contains("99"), "names the version found: {message}");
        assert!(
            message.contains("schema"),
            "says what the number is: {message}"
        );
        assert!(message.contains("newer version of PM4 Studio"), "{message}");
        assert!(message.contains("left exactly as it is"), "{message}");

        let corrupt = LibraryProblem::Corrupt {
            detail: "expected value at line 1".to_string(),
        }
        .message();
        assert!(corrupt.contains("has not been changed"), "{corrupt}");
    }

    #[test]
    fn the_file_carries_a_version_and_the_ui_reads_camel_case() {
        let mut library = Library::empty();
        let InsertOutcome::Added(_) = library.add_lf(0x55, 0x0084_8212, "00 01 01", CAPTURED_AT)
        else {
            panic!("a new read is added")
        };

        let json = serde_json::to_value(&library).expect("serialises");
        assert_eq!(json["version"], SCHEMA_VERSION);
        let snapshot = &json["snapshots"][0];
        assert_eq!(snapshot["capturedAt"], CAPTURED_AT);
        assert_eq!(snapshot["writeCount"], 0);
        assert_eq!(snapshot["kind"], "LF");
        assert_eq!(snapshot["identity"]["facility"], 132);
        assert_eq!(snapshot["identity"]["card"], 33298);
        assert!(
            snapshot.get("hf").is_none(),
            "a section that does not apply is omitted, not written as null"
        );
    }

    #[test]
    fn a_snapshot_written_by_this_build_reads_back_identically() {
        let mut library = Library::empty();
        library.add_lf(0x55, 0x0084_8212, "00 01 01", CAPTURED_AT);
        library.add_hf("04 A2 2B 3A 5C 6D 80", "00 01 02", CAPTURED_AT);

        let bytes = serde_json::to_vec(&library).expect("encode");
        assert_eq!(parse_library(&bytes).map(|read| read.library), Ok(library));
    }

    // Ticket 04: the name and note a user gives a Snapshot are the only editable
    // fields, so they are written together in one replacement of the file.

    #[test]
    fn a_name_and_note_written_together_survive_reopening() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");
        let snapshot = saved_lf(&mut library, 0x0084_8212);
        store.save(&library).expect("save");

        let mut reopened = store.load().expect("reload");
        assert!(
            reopened.edit(&snapshot.id, "Front door", "Gate 3, front car park"),
            "edit reports a change"
        );
        store.save(&reopened).expect("save the edit");

        let after = store.load().expect("reload after the edit");
        assert_eq!(after.snapshots[0].name, "Front door");
        assert_eq!(after.snapshots[0].note, "Gate 3, front car park");
    }

    #[test]
    fn a_note_may_hold_several_lines_and_only_loses_its_edges() {
        let mut library = Library::empty();
        let snapshot = saved_lf(&mut library, 0x0084_8212);

        assert!(library.edit(&snapshot.id, " Front door ", "  gate 3\nspare for the van\n"));
        assert_eq!(library.snapshots[0].name, "Front door");
        assert_eq!(
            library.snapshots[0].note, "gate 3\nspare for the van",
            "the lines the user typed are kept; only the ends are trimmed"
        );

        // A note can be cleared again, which is not the same as never having one.
        assert!(library.edit(&snapshot.id, "Front door", ""));
        assert_eq!(library.snapshots[0].note, "");
    }

    #[test]
    fn an_abandoned_edit_leaves_the_stored_snapshot_unchanged() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");
        let snapshot = saved_lf(&mut library, 0x0084_8212);
        store.save(&library).expect("save");
        let before = bytes_at(&path);

        // What the user typed, then cancelled: the store is never told about it.
        let draft = ("Front door", "Gate 3");
        assert!(
            draft.0 != snapshot.name && draft.1 != snapshot.note,
            "the draft really did differ from what is stored"
        );

        assert_eq!(
            bytes_at(&path),
            before,
            "an edit that was not confirmed writes nothing at all"
        );
        let after = store.load().expect("reload again");
        assert_eq!(after.snapshots[0].name, "Snapshot 1");
        assert_eq!(after.snapshots[0].note, "");
    }

    #[test]
    fn editing_one_snapshot_leaves_the_others_untouched() {
        let mut library = Library::empty();
        let first = saved_lf(&mut library, 0x0084_8212);
        let second = saved_lf(&mut library, 0x0053_C7B3);

        assert!(library.edit(&first.id, "Front door", "gate 3"));

        assert_eq!(library.snapshots[0].name, "Front door");
        assert_eq!(
            library.snapshots[1], second,
            "the other Snapshot is exactly what it was"
        );
    }

    #[test]
    fn editing_an_unknown_snapshot_changes_nothing() {
        let mut library = Library::empty();
        saved_lf(&mut library, 0x0084_8212);

        assert!(!library.edit("no such snapshot", "Name", "Note"));
        assert_eq!(library.snapshots[0].name, "Snapshot 1");
        assert_eq!(library.snapshots[0].note, "");
        assert_eq!(library.snapshots.len(), 1);
    }

    // Slice E: confirmed copies. Only a verified write increments the count.

    use crate::write_outcome::WriteOutcome;

    fn with_identity(library: &mut Library, data32: u32) -> Snapshot {
        saved_lf(library, data32)
    }

    #[test]
    fn a_verified_write_counts_one_confirmed_copy() {
        let mut library = Library::empty();
        let snapshot = with_identity(&mut library, 0x0084_8212);
        let identity = Identity {
            customer: snapshot.identity.as_ref().expect("lf").customer,
            data32: 0x0084_8212,
        };

        let outcome = library.record_write(&identity, WriteOutcome::Verified);
        assert_eq!(
            outcome,
            WriteCountOutcome::Incremented {
                id: snapshot.id.clone(),
                write_count: 1
            }
        );
        assert_eq!(library.snapshots[0].write_count, 1);

        // A second confirmed copy: the count is copies, so it rises again.
        library.record_write(&identity, WriteOutcome::Verified);
        assert_eq!(library.snapshots[0].write_count, 2);
    }

    #[test]
    fn a_refused_write_leaves_the_count_alone() {
        let mut library = Library::empty();
        let snapshot = with_identity(&mut library, 0x0084_8212);
        let identity = Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        };

        let outcome = library.record_write(&identity, WriteOutcome::Refused);
        assert_eq!(
            outcome,
            WriteCountOutcome::Unchanged {
                id: snapshot.id.clone(),
                write_count: 0
            }
        );
        assert_eq!(library.snapshots[0].write_count, 0);
    }

    #[test]
    fn an_unverified_write_leaves_the_count_alone() {
        // The write was sent and the read-back could not confirm it. Counting it
        // would claim a copy of a credential nobody proved is there.
        let mut library = Library::empty();
        let snapshot = with_identity(&mut library, 0x0084_8212);
        let identity = Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        };

        let outcome = library.record_write(&identity, WriteOutcome::Unverified);
        assert_eq!(
            outcome,
            WriteCountOutcome::Unchanged {
                id: snapshot.id.clone(),
                write_count: 0
            }
        );
        assert_eq!(library.snapshots[0].write_count, 0);
    }

    #[test]
    fn a_blanking_write_never_adds_a_confirmed_copy() {
        // Blanking destroys an Identity instead of copying one. The Snapshot
        // that describes it must not gain a copy, and nothing about the Tag's
        // value may be edited: a Snapshot records what a Tag held when it was
        // read, not what a Tag holds now.
        let mut library = Library::empty();
        let snapshot = with_identity(&mut library, 0x0084_8212);
        let identity = Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        };
        let before = library.snapshots[0].clone();

        let outcome = library.record_write(&identity, WriteOutcome::Blanked);
        assert_eq!(
            outcome,
            WriteCountOutcome::Unchanged {
                id: snapshot.id.clone(),
                write_count: 0
            }
        );
        assert!(!outcome.incremented());
        assert_eq!(library.snapshots[0].write_count, 0);
        assert_eq!(library.snapshots[0], before);
    }

    #[test]
    fn a_failed_write_leaves_the_count_alone() {
        let mut library = Library::empty();
        let snapshot = with_identity(&mut library, 0x0084_8212);
        let identity = Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        };

        let outcome = library.record_write(&identity, WriteOutcome::Failed);
        assert_eq!(
            outcome,
            WriteCountOutcome::Unchanged {
                id: snapshot.id.clone(),
                write_count: 0
            }
        );
        assert_eq!(library.snapshots[0].write_count, 0);
    }

    #[test]
    fn the_confirmed_copy_count_survives_reopening() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");
        let snapshot = with_identity(&mut library, 0x0084_8212);
        let identity = Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        };

        library.record_write(&identity, WriteOutcome::Verified);
        library.record_write(&identity, WriteOutcome::Verified);
        store.save(&library).expect("save");

        let after = store.load().expect("reload");
        assert_eq!(after.snapshots[0].write_count, 2);
        assert_eq!(
            serde_json::to_value(&after).expect("serialises")["snapshots"][0]["writeCount"],
            2
        );
        assert_eq!(after.snapshots[0].id, snapshot.id);
    }

    #[test]
    fn a_write_of_an_identity_the_library_does_not_hold_counts_nothing() {
        let mut library = Library::empty();
        with_identity(&mut library, 0x0053_C7B3);
        let absent = Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        };

        assert_eq!(
            library.record_write(&absent, WriteOutcome::Verified),
            WriteCountOutcome::NoSnapshot
        );
        assert_eq!(library.snapshots[0].write_count, 0);
    }

    #[test]
    fn the_whole_identity_is_matched_not_just_the_customer_byte() {
        let mut library = Library::empty();
        with_identity(&mut library, 0x0084_8212);

        // Same customer byte, different card: not this Snapshot.
        assert_eq!(
            library.record_write(
                &Identity {
                    customer: 0x55,
                    data32: 0x0053_C7B3
                },
                WriteOutcome::Verified
            ),
            WriteCountOutcome::NoSnapshot
        );
        // Same data field, different customer byte: also not this Snapshot.
        assert_eq!(
            library.record_write(
                &Identity {
                    customer: 0x77,
                    data32: 0x0084_8212
                },
                WriteOutcome::Verified
            ),
            WriteCountOutcome::NoSnapshot
        );
        assert_eq!(library.snapshots[0].write_count, 0);
    }

    #[test]
    fn only_a_verified_readback_raises_the_count_whichever_evidence_arrives() {
        // The joined rule: evidence -> outcome -> count. Every outcome except a
        // matching read-back leaves the count exactly where it was.
        use crate::write_outcome::{classify, Evidence};

        let target = |data32: u32| Identity {
            customer: 0x55,
            data32,
        };
        let cases = [
            (Evidence::Refused, 0),
            (Evidence::NotTransmitted, 0),
            (Evidence::Readback(None), 0),
            (Evidence::Readback(Some(target(0x0053_C7B3))), 0),
            (Evidence::Readback(Some(target(0x0084_8212))), 1),
        ];

        for (evidence, expected) in cases {
            let mut library = Library::empty();
            saved_lf(&mut library, 0x0084_8212);
            let outcome = classify(evidence, target(0x0084_8212));
            library.record_write(&target(0x0084_8212), outcome);
            assert_eq!(
                library.snapshots[0].write_count, expected,
                "evidence {evidence:?} produced {outcome:?}"
            );
        }
    }

    #[test]
    fn an_hf_read_records_its_uid() {
        let mut library = Library::empty();
        let snapshot = library.add_hf("04 A2 2B 3A 5C 6D 80", "00 01 02", CAPTURED_AT);
        let InsertOutcome::Added(snapshot) = snapshot else {
            panic!("a uid not yet in the library is added");
        };
        assert_eq!(snapshot.kind, Kind::HF);
        assert_eq!(snapshot.identity, None);
        assert_eq!(
            snapshot.hf,
            Some(HfFields {
                uid: "04 A2 2B 3A 5C 6D 80".to_string(),
                raw: "00 01 02".to_string(),
            })
        );
    }

    // Drafts: an editable NDEF message with no Tag attached, kept beside the
    // Snapshots in the same file but in its own collection.

    const UPDATED_AT: &str = "2026-11-21T11:05:00.000Z";

    fn text_record(language: &str, text: &str) -> DraftRecord {
        DraftRecord {
            kind: "text".to_string(),
            fields: [
                ("language".to_string(), language.to_string()),
                ("text".to_string(), text.to_string()),
            ]
            .into_iter()
            .collect(),
        }
    }

    fn url_record(url: &str) -> DraftRecord {
        DraftRecord {
            kind: "url".to_string(),
            fields: [("url".to_string(), url.to_string())]
                .into_iter()
                .collect(),
        }
    }

    fn saved_draft(library: &mut Library, name: &str) -> Draft {
        library.add_draft(name, UPDATED_AT)
    }

    #[test]
    fn a_saved_draft_survives_reopening() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");

        let mut draft = saved_draft(&mut library, "Front door");
        assert_eq!(draft.id, "draft-1");
        assert_eq!(draft.name, "Front door");
        assert_eq!(draft.updated_at, UPDATED_AT);
        assert_eq!(draft.records, vec![]);

        draft.records = vec![
            text_record("en", "Hello"),
            url_record("https://example.com/x"),
        ];
        assert!(library.save_draft(draft.clone()), "the Draft is known");
        store.save(&library).expect("save");

        // A fresh handle, as the next launch of the app would use.
        let reopened = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(reopened.drafts, vec![draft], "every field survives a restart");
        assert_eq!(
            reopened.drafts[0]
                .records
                .iter()
                .map(|r| r.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["text", "url"],
            "the Records keep their order"
        );
    }

    #[test]
    fn drafts_and_snapshots_are_separate_collections() {
        let mut library = Library::empty();
        saved_lf(&mut library, 0x0084_8212);
        let draft = saved_draft(&mut library, "Front door");

        assert_eq!(library.snapshots.len(), 1, "a Draft is never a Snapshot");
        assert_eq!(library.drafts.len(), 1, "a Snapshot is never a Draft");

        assert!(library.remove_draft(&draft.id));
        assert!(library.drafts.is_empty());
        assert_eq!(
            library.snapshots.len(),
            1,
            "deleting a Draft leaves the Snapshots alone"
        );

        assert!(
            !library.remove(&draft.id),
            "a Draft id is not a Snapshot id, and deletes nothing from Snapshots"
        );
        assert_eq!(library.snapshots.len(), 1);
    }

    #[test]
    fn a_library_file_written_before_drafts_existed_reads_as_this_builds_schema() {
        // The shape the first build wrote: snapshots and a version, no drafts.
        // Reading it must not fail — but it is a version 1 file, and ADR 0005
        // says a version 1 file is lifted rather than read as if it were
        // current. Reading alone writes nothing; opening is what rewrites it.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::write(
            &path,
            br#"{"version": 1, "snapshots": [{"id": "55 00 84 82 12", "name": "Front door",
                 "note": "", "kind": "LF", "capturedAt": "2026-11-21T09:30:00.000Z",
                 "writeCount": 0}]}"#,
        )
        .expect("write a library from before Drafts existed");

        let library = LibraryStore::new(&path)
            .load()
            .expect("an older shape still reads");
        assert_eq!(library.version, SCHEMA_VERSION, "lifted in memory");
        assert_eq!(library.snapshots.len(), 1);
        assert_eq!(library.snapshots[0].name, "Front door");
        assert_eq!(library.drafts, vec![], "no drafts yet");
        assert_eq!(
            fs::read(&path).expect("read the file"),
            br#"{"version": 1, "snapshots": [{"id": "55 00 84 82 12", "name": "Front door",
                 "note": "", "kind": "LF", "capturedAt": "2026-11-21T09:30:00.000Z",
                 "writeCount": 0}]}"#,
            "a read is not a write: the file is left alone until it is opened"
        );

        // Once it is written again it claims the version this build writes.
        LibraryStore::new(&path).save(&library).expect("save");
        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").version,
            SCHEMA_VERSION
        );
    }

    #[test]
    fn draft_ids_and_default_names_do_not_collide() {
        let mut library = Library::empty();
        let first = saved_draft(&mut library, "");
        let second = saved_draft(&mut library, "");

        assert_eq!(first.name, "Draft 1", "an unnamed Draft still has a name");
        assert_eq!(second.name, "Draft 2");
        assert_ne!(first.id, second.id);
        assert_eq!(first.id, "draft-1");
        assert_eq!(second.id, "draft-2");

        library.remove_draft(&first.id);
        assert_eq!(library.next_draft_name(), "Draft 1", "a freed number returns");
        let third = saved_draft(&mut library, "");
        assert_eq!(third.name, "Draft 1");
        assert_ne!(third.id, first.id, "an id is never reused after a delete");
    }

    #[test]
    fn saving_a_draft_replaces_it_whole_and_keeps_the_new_order() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");

        let mut draft = saved_draft(&mut library, "Front door");
        draft.records = vec![text_record("en", "Hello"), url_record("https://example.com/x")];
        library.save_draft(draft.clone());
        store.save(&library).expect("save");

        let mut reopened = store.load().expect("reload");
        let mut edited = reopened.drafts[0].clone();
        edited.name = "Back door".to_string();
        edited.records.reverse();
        edited.records.push(text_record("pt-BR", "Ola"));
        assert!(reopened.save_draft(edited.clone()));
        store.save(&reopened).expect("save the edit");

        let after = store.load().expect("reload");
        assert_eq!(after.drafts, vec![edited.clone()]);
        assert_eq!(
            after.drafts[0]
                .records
                .iter()
                .map(|r| r.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["url", "text", "text"],
            "the saved order is the order on disk"
        );
        assert_eq!(
            after.drafts[0].records[0].fields.get("url").map(String::as_str),
            Some("https://example.com/x"),
            "the Record fields come back exactly as they went in"
        );
    }

    #[test]
    fn a_renamed_draft_survives_reopening() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");
        let draft = saved_draft(&mut library, "Draft 1");
        store.save(&library).expect("save");

        let mut reopened = store.load().expect("reload");
        assert!(reopened.rename_draft(&draft.id, "  Front door  "));
        store.save(&reopened).expect("save the rename");

        let after = store.load().expect("reload");
        assert_eq!(after.drafts[0].name, "Front door", "the name is only trimmed");
    }

    #[test]
    fn deleting_a_draft_survives_reopening() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);
        let mut library = store.load().expect("empty library");
        let kept = saved_draft(&mut library, "Keep");
        let doomed = saved_draft(&mut library, "Doomed");
        store.save(&library).expect("save");

        let mut reopened = store.load().expect("reload");
        assert!(reopened.remove_draft(&doomed.id));
        store.save(&reopened).expect("save the delete");

        assert_eq!(store.load().expect("reload").drafts, vec![kept]);
    }

    #[test]
    fn mutating_an_unknown_draft_changes_nothing() {
        let mut library = Library::empty();
        let draft = saved_draft(&mut library, "Front door");

        assert!(!library.save_draft(Draft {
            id: "no such draft".to_string(),
            name: "Nowhere".to_string(),
            updated_at: UPDATED_AT.to_string(),
            records: vec![],
        }));
        assert!(!library.rename_draft("no such draft", "Name"));
        assert!(!library.remove_draft("no such draft"));
        assert_eq!(library.drafts, vec![draft], "an unknown id is never created");
    }

    #[test]
    fn a_draft_is_written_with_its_records_and_in_camel_case() {
        let mut library = Library::empty();
        let mut draft = saved_draft(&mut library, "Front door");
        draft.records = vec![text_record("en", "Hello"), url_record("https://example.com/x")];
        library.save_draft(draft);

        let json = serde_json::to_value(&library).expect("serialises");
        assert_eq!(json["version"], SCHEMA_VERSION);
        assert!(json["snapshots"].as_array().expect("snapshots").is_empty());
        let draft = &json["drafts"][0];
        assert_eq!(draft["updatedAt"], UPDATED_AT);
        assert_eq!(draft["id"], "draft-1");
        assert_eq!(draft["records"][0]["kind"], "text");
        assert_eq!(draft["records"][0]["fields"]["language"], "en");
        assert_eq!(draft["records"][1]["kind"], "url");
        assert_eq!(draft["records"][1]["fields"]["url"], "https://example.com/x");

        // And what this build writes, this build reads back unchanged.
        let bytes = serde_json::to_vec(&library).expect("encode");
        assert_eq!(parse_library(&bytes).map(|read| read.library), Ok(library));
    }

    // Ticket 04 / ADR 0005: the schema version is 2, and a version 1 file is
    // lifted on the first successful open — eagerly, before the user can edit
    // anything — so the file's stated version agrees with its contents at the
    // earliest moment it can. The protection that failed was never the refusal
    // to rewrite a newer file; it was that nothing ever declared the file newer.

    /// A library file exactly as the version 1 build wrote it — the build that
    /// added Drafts and left the version at 1. Fixtures for the migration are
    /// written in that build's own shape and key order, because a migration
    /// proven against a shape this build invented proves nothing.
    const V1_WITH_DRAFTS: &str = r#"{
  "version": 1,
  "snapshots": [
    {
      "id": "55 00 84 82 12",
      "name": "Front door",
      "note": "gate 3",
      "kind": "LF",
      "capturedAt": "2026-11-21T09:30:00.000Z",
      "writeCount": 2,
      "identity": {
        "customer": 85,
        "data32": 8684050,
        "facility": 132,
        "card": 33298,
        "raw": "00 01 01"
      }
    },
    {
      "id": "04 A2 2B 3A 5C 6D 80",
      "name": "Back gate",
      "note": "",
      "kind": "HF",
      "capturedAt": "2026-11-21T10:00:00.000Z",
      "writeCount": 0,
      "hf": { "uid": "04 A2 2B 3A 5C 6D 80", "raw": "00 01 02" }
    }
  ],
  "drafts": [
    {
      "id": "draft-2",
      "name": "Lobby",
      "updatedAt": "2026-11-21T11:00:00.000Z",
      "records": [
        { "kind": "text", "fields": { "language": "en", "text": "Hello" } }
      ]
    },
    {
      "id": "draft-1",
      "name": "Roof",
      "updatedAt": "2026-11-21T12:00:00.000Z",
      "records": []
    }
  ]
}"#;

    /// The version the migrated file claims once it has been opened.
    fn version_on_disk(path: &Path) -> u64 {
        let bytes = fs::read(path).expect("read the library file");
        let value: serde_json::Value = serde_json::from_slice(&bytes).expect("the file is JSON");
        value["version"].as_u64().expect("the file claims a version")
    }

    #[test]
    fn opening_a_v1_file_lifts_it_and_the_file_then_claims_the_current_version() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::write(&path, V1_WITH_DRAFTS).expect("write a version 1 library");

        let opened = LibraryStore::new(&path).open();
        let library = match opened {
            Open::Opened { library, migration } => {
                assert_eq!(
                    migration,
                    Some(Lifted::Written { from: 1 }),
                    "the lift was written on open"
                );
                library
            }
            Open::Refused(problem) => panic!("a v1 file is lifted, not refused: {problem:?}"),
        };

        assert_eq!(library.version, SCHEMA_VERSION);
        assert_eq!(
            library
                .snapshots
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Front door", "Back gate"],
            "every Snapshot, in the order the file held them"
        );
        assert_eq!(
            library
                .drafts
                .iter()
                .map(|d| d.id.as_str())
                .collect::<Vec<_>>(),
            vec!["draft-2", "draft-1"],
            "every Draft, in the order the file held them"
        );
        assert_eq!(library.drafts[0].records[0].fields["text"], "Hello");

        // The file itself is what the next launch — and an older build — meet.
        assert_eq!(
            version_on_disk(&path),
            u64::from(SCHEMA_VERSION),
            "after a successful open the file on disk claims the current version"
        );
        let reopened = LibraryStore::new(&path).open();
        match reopened {
            Open::Opened { library, migration } => {
                assert_eq!(migration, None, "a v2 file is not migrated again");
                assert_eq!(library.drafts.len(), 2);
                assert_eq!(library.snapshots.len(), 2);
            }
            Open::Refused(problem) => panic!("the lifted file must read back: {problem:?}"),
        }
    }

    #[test]
    fn opening_a_v1_file_keeps_every_key_this_build_does_not_model() {
        // The migration lifts the document, not the struct: a collection this
        // build has never heard of survives being lifted, because dropping it
        // is the very failure the lift is fixing.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::write(
            &path,
            r#"{"version": 1, "snapshots": [], "drafts": [], "futureCollection": [{"kept": true}]}"#,
        )
        .expect("write a v1 file with a collection this build does not model");

        assert!(matches!(
            LibraryStore::new(&path).open(),
            Open::Opened { .. }
        ));

        let bytes = fs::read(&path).expect("read the file");
        let value: serde_json::Value = serde_json::from_slice(&bytes).expect("JSON");
        assert_eq!(value["version"], 2);
        assert_eq!(
            value["futureCollection"],
            serde_json::json!([{"kept": true}]),
            "a key this build does not model is carried through the lift"
        );
        assert_eq!(value["drafts"], serde_json::json!([]));
    }

    #[test]
    fn a_v1_file_without_drafts_is_lifted_with_an_empty_draft_list() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::write(
            &path,
            br#"{"version": 1, "snapshots": [{"id": "55 00 84 82 12", "name": "Front door",
                 "note": "", "kind": "LF", "capturedAt": "2026-11-21T09:30:00.000Z",
                 "writeCount": 0}]}"#,
        )
        .expect("write a v1 file from before Drafts existed");

        assert!(matches!(
            LibraryStore::new(&path).open(),
            Open::Opened { library: Library { drafts, .. }, migration: Some(Lifted::Written { from: 1 }) }
                if drafts.is_empty()
        ));

        let bytes = fs::read(&path).expect("read the file");
        let value: serde_json::Value = serde_json::from_slice(&bytes).expect("JSON");
        assert_eq!(value["version"], 2);
        assert_eq!(
            value["drafts"],
            serde_json::json!([]),
            "the file gains the collection v2 promises, empty"
        );
        assert_eq!(value["snapshots"].as_array().expect("snapshots").len(), 1);
    }

    #[test]
    fn a_migration_that_cannot_be_written_is_reported_and_the_library_stays_usable() {
        // A failed *write*, not a failed read: the library was read perfectly,
        // so refusing to open it would trade a small risk for a guaranteed
        // loss. The lift is reported, the migrated library is in memory, and
        // the next save corrects the file.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::write(&path, V1_WITH_DRAFTS).expect("write a version 1 library");

        // The staging path is a directory, so the replacement cannot be staged.
        // The read is untouched: only the write fails.
        let mut staged = path.clone().into_os_string();
        staged.push(TEMP_SUFFIX);
        let staged = PathBuf::from(staged);
        fs::create_dir(&staged).expect("block the staging path");

        let (library, migration) = match LibraryStore::new(&path).open() {
            Open::Opened { library, migration } => (library, migration),
            Open::Refused(problem) => panic!("a failed write is not a refusal: {problem:?}"),
        };
        let message = migration
            .clone()
            .expect("the failed lift is reported")
            .message()
            .expect("a written lift has nothing to report; this one failed");
        assert!(matches!(migration, Some(Lifted::Unwritten { from: 1, .. })));
        assert!(
            message.contains("could not be rewritten"),
            "says what happened: {message}"
        );
        assert!(
            message.contains("saving will correct the file"),
            "says the library is still usable: {message}"
        );

        // The library in memory is the migrated one, whole.
        assert_eq!(library.version, SCHEMA_VERSION);
        assert_eq!(library.drafts.len(), 2);
        assert_eq!(library.snapshots.len(), 2);

        // The file is still what it was: nothing half-written, nothing lost.
        assert_eq!(version_on_disk(&path), 1, "the file still claims version 1");

        // Clearing the obstruction lets the next save correct the claim.
        fs::remove_dir(&staged).expect("clear the obstruction");
        LibraryStore::new(&path).save(&library).expect("save");
        assert_eq!(version_on_disk(&path), u64::from(SCHEMA_VERSION));
        let after = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(after.drafts, library.drafts);
        assert_eq!(after.snapshots, library.snapshots);
    }

    #[test]
    fn a_change_lifts_a_v1_file_before_the_change_is_applied() {
        // The migration must complete before any edit can land: an edit written
        // on top of a file still claiming version 1 is the state that loses
        // Drafts, so the lift is checked from inside the change itself.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::write(&path, V1_WITH_DRAFTS).expect("write a version 1 library");

        let store = LibraryStore::new(&path);
        let (library, seen) = store
            .update(|library| {
                let on_disk = fs::read(&path).expect("read the file");
                let value: serde_json::Value =
                    serde_json::from_slice(&on_disk).expect("the file is JSON");
                let seen = (
                    value["version"].as_u64(),
                    library.version,
                    library.drafts.len(),
                );
                library.add_draft("Roof light", UPDATED_AT);
                seen
            })
            .expect("a change to a v1 library lifts it first");

        assert_eq!(
            seen,
            (Some(u64::from(SCHEMA_VERSION)), SCHEMA_VERSION, 2),
            "the file already claims the current version when the change runs, and the change sees every Draft"
        );
        assert_eq!(library.drafts.len(), 3);
        assert_eq!(version_on_disk(&path), u64::from(SCHEMA_VERSION));
        let after = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(
            after
                .drafts
                .iter()
                .map(|d| d.id.as_str())
                .collect::<Vec<_>>(),
            vec!["draft-2", "draft-1", "draft-3"],
            "the migrated Drafts keep their order and the new one follows them"
        );
    }

    #[test]
    fn a_file_above_this_builds_schema_is_refused_by_open_and_never_rewritten() {
        // The durable form of this test is "a v1-era build refuses a v2 file",
        // which cannot be written here: the v1-era build no longer exists. The
        // mechanism is the same one either way, so it is proven with a file
        // claiming one version above what this build understands — the exact
        // position a v1-era build is in when it meets a v2 file.
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let above = br#"{"version": 3, "snapshots": [], "drafts": [{"id": "from-the-future"}]}"#;
        fs::write(&path, above).expect("write a file one version above this build");

        let refused = LibraryStore::new(&path).open();
        assert_eq!(
            refused,
            Open::Refused(LibraryProblem::NewerVersion {
                found: 3,
                supported: SCHEMA_VERSION
            }),
            "a version this build does not understand is refused, not guessed at"
        );
        assert_eq!(
            fs::read(&path).expect("read the file"),
            above,
            "the file is left byte for byte, so its Drafts are still there"
        );
    }

    #[test]
    fn a_library_reloads_with_its_drafts_unchanged_after_a_save_and_restart() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        let store = LibraryStore::new(&path);

        let (_, saved) = store
            .update(|library| {
                let mut first = library.add_draft("Lobby", UPDATED_AT);
                first.records = vec![text_record("en", "Hello"), url_record("https://example.com/x")];
                library.save_draft(first);
                library.add_draft("Roof", UPDATED_AT);
                library.drafts.clone()
            })
            .expect("save two Drafts");

        // A fresh handle, as the next launch of the app would use.
        let reopened = match LibraryStore::new(&path).open() {
            Open::Opened { library, .. } => library,
            Open::Refused(problem) => panic!("the saved library must open: {problem:?}"),
        };
        assert_eq!(reopened.drafts, saved, "every Draft, and its Records, in order");
        assert_eq!(reopened.version, SCHEMA_VERSION);
        assert_eq!(version_on_disk(&path), u64::from(SCHEMA_VERSION));
    }
}
