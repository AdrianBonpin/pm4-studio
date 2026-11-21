//! The library: Snapshots persisted in one versioned JSON file.
//!
//! The file is replaced atomically — a sibling temp file is written and flushed
//! to disk, then renamed over the library — so an interrupted save leaves the
//! previous library exactly as it was. A file that cannot be read, or that was
//! written by a newer schema version, is reported and never overwritten: a
//! clean start on top of unreadable bytes is data loss.
//!
//! Nothing here touches the Reader, so every test runs against a real temp
//! directory with no hardware attached.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::identity::Identity;

/// The schema version this build writes and understands.
pub const SCHEMA_VERSION: u32 = 1;

/// Suffix of the staging file a save writes before renaming it into place.
const TEMP_SUFFIX: &str = ".tmp";

/// Saves stage into one fixed temp path, so two of them must not run at once or
/// they could interleave bytes and then rename the mess into place. The lock
/// also makes the "may this file be replaced?" check and the rename that
/// follows it one indivisible step.
static SAVE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Library {
    pub version: u32,
    pub snapshots: Vec<Snapshot>,
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
    fn tag_key(&self) -> Option<String> {
        match (&self.identity, &self.hf) {
            (Some(identity), _) => Some(format!(
                "LF:{:02X}:{:08X}",
                identity.customer, identity.data32
            )),
            (None, Some(hf)) => Some(format!("HF:{}", hf.uid)),
            // A raw-only Snapshot carries nothing to compare, so it is never a
            // duplicate of anything.
            (None, None) => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum LibraryProblem {
    /// The bytes are not a library this build can read.
    Corrupt { detail: String },
    /// Written by a newer schema; rewriting it would downgrade the user's data.
    NewerVersion { found: u64, supported: u32 },
    /// An older schema this build does not read.
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

    /// Load the library, or report why the file must not be touched.
    pub fn load(&self) -> Result<Library, LibraryProblem> {
        match fs::read(&self.path) {
            Ok(bytes) => parse_library(&bytes),
            // A missing file is a library nobody has written to yet.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Library::empty()),
            Err(e) => Err(LibraryProblem::Unreadable {
                detail: e.to_string(),
            }),
        }
    }

    /// Replace the library file atomically.
    ///
    /// The replacement is written to a sibling temp file and flushed to disk
    /// before it is renamed over the library, so a crash at any point leaves
    /// either the previous library or the new one — never a truncated file.
    pub fn save(&self, library: &Library) -> Result<(), SaveError> {
        let _serialised = SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Never replace a file this build cannot read: the bytes on disk may be
        // the user's only copy, and a clean start would destroy them.
        if let Err(problem) = self.load() {
            return Err(SaveError::Refused(problem));
        }
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| {
                    SaveError::Io(format!("could not create {}: {e}", parent.display()))
                })?;
            }
        }
        let staged = self
            .stage(library)
            .map_err(|e| SaveError::Io(e.to_string()))?;
        self.commit(&staged)
            .map_err(|e| SaveError::Io(e.to_string()))
    }

    /// The staging half of an atomic replacement: write the replacement to a
    /// sibling temp file and flush it. Nothing is visible at `path` yet.
    fn stage(&self, library: &Library) -> std::io::Result<PathBuf> {
        let bytes = serde_json::to_vec_pretty(library)?;
        let mut tmp = self.path.clone().into_os_string();
        tmp.push(TEMP_SUFFIX);
        let tmp = PathBuf::from(tmp);
        let mut file = File::create(&tmp)?;
        file.write_all(&bytes)?;
        // The bytes must be on the platter before the rename, or a power cut can
        // leave an empty library where a complete one was promised.
        file.sync_all()?;
        Ok(tmp)
    }

    /// The commit half: one rename, which is atomic on the same filesystem.
    fn commit(&self, staged: &Path) -> std::io::Result<()> {
        fs::rename(staged, &self.path)?;
        if let Some(parent) = self.path.parent() {
            // Flush the directory entry so the rename itself is durable.
            if let Ok(dir) = File::open(parent) {
                let _ = dir.sync_all();
            }
        }
        Ok(())
    }
}

impl Library {
    pub fn empty() -> Self {
        Self {
            version: SCHEMA_VERSION,
            snapshots: Vec::new(),
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
}

/// Decode one library file, deciding first whether this build may read it at all.

fn parse_library(bytes: &[u8]) -> Result<Library, LibraryProblem> {
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
    if found < u64::from(SCHEMA_VERSION) {
        return Err(LibraryProblem::OlderVersion {
            found,
            supported: SCHEMA_VERSION,
        });
    }
    serde_json::from_value(value).map_err(|e| LibraryProblem::Corrupt {
        detail: e.to_string(),
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

        let replacement = store
            .stage(&library_with(&["56 00 53 C7 B3"]))
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
        let staged = blocked_store
            .stage(&library_with(&["56 00 53 C7 B3"]))
            .expect("stage");
        assert!(
            blocked_store.commit(&staged).is_err(),
            "a commit that cannot rename must report failure"
        );

        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").snapshots,
            vec![snapshot("55 00 84 82 12")],
            "the previous library survives a failed commit"
        );
    }

    #[test]
    fn saves_from_several_threads_leave_one_readable_library() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");

        let mut handles = Vec::new();
        for n in 0..4u32 {
            let path = path.clone();
            handles.push(std::thread::spawn(move || {
                for _ in 0..10 {
                    let store = LibraryStore::new(&path);
                    let mut library = store.load().unwrap_or_else(|_| Library::empty());
                    let _ = library.add_lf(0x55, 0x0084_8212 + n, "00 01 01", CAPTURED_AT);
                    store.save(&library).expect("save");
                }
            }));
        }
        for handle in handles {
            handle.join().expect("thread");
        }

        let library = LibraryStore::new(&path)
            .load()
            .expect("the file is still a library after concurrent saves");
        assert!(
            (1..=4).contains(&library.snapshots.len()),
            "got {} snapshots",
            library.snapshots.len()
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
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        fs::write(&path, br#"{"version": 0, "snapshots": []}"#).expect("write");

        assert!(matches!(
            LibraryStore::new(&path).load(),
            Err(LibraryProblem::OlderVersion { found: 0, .. })
        ));
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
        assert_eq!(parse_library(&bytes), Ok(library));
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
}
