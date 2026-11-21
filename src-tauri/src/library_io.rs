//! Exporting the library to a file the user chooses, and importing one back.
//!
//! One schema, one set of rules: an export *is* a library document, so the
//! store's own reading rules decide whether a file may be imported at all (see
//! `library.rs`), and a file from a newer schema is refused rather than
//! mangled. Import merges — it adds what is missing and leaves what is already
//! here exactly as it is — so the two ways a library can be lost, silently
//! duplicating an entry and silently destroying one, are both closed.
//!
//! Collections this build does not understand are carried verbatim, so a
//! collection added by a later build survives an export and an import rather
//! than being dropped. Drafts are in this build's schema, so they are merged as
//! typed entries beside the Snapshots on the terms the store itself uses.
//!
//! Nothing here touches the Reader, so every test runs against a real temp
//! directory with no hardware attached.
//!
//! Every write to the library file here happens inside the library's
//! serialisation domain (see [`crate::library::serialised`]): an import merges
//! into the library and then replaces it, and a save from the store could
//! otherwise read the same starting library and replace it too, losing the merge.
//! A file that is not the library — a dump the user chose a destination for — is
//! outside it, and does not queue behind a save.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::atomic_file::{commit_staged, stage_bytes};
use crate::library::{
    document_from, serialised, write_atomically, Domain, Draft, Library, LibraryProblem,
    LibraryStore, Snapshot, TYPED_KEYS,
};

/// One library document as a file holds it.
///
/// Snapshots and Drafts are typed because this build understands both.
/// Everything else is kept exactly as it was read, so a collection this build
/// has never heard of survives an export and an import untouched.
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub library: Library,
    /// Every other top-level key the file carries.
    pub rest: Map<String, Value>,
}

impl Document {
    /// The library nobody has written to yet.
    pub fn empty() -> Self {
        Self {
            library: Library::empty(),
            rest: Map::new(),
        }
    }

    /// How many Drafts the document carries.
    pub fn draft_count(&self) -> usize {
        self.library.drafts.len()
    }

    /// The document as it is written to a file.
    ///
    /// The typed keys are written in the order the store itself writes them, so
    /// a library file and its export are the same file — and through the store's
    /// own writer, so neither can start carrying a key the other drops.
    pub fn to_json(&self) -> Value {
        document_from(&self.library, &self.rest)
    }
}

/// Why an export or an import did not happen.
#[derive(Debug, Clone, PartialEq)]
pub enum FileError {
    /// The file is not a library this build may read, or the library itself is
    /// not one it may write. Nothing was changed.
    Refused(LibraryProblem),
    /// The file could not be written. The file that was already there, if any,
    /// is untouched.
    Io(String),
}

impl FileError {
    /// What to tell the user. Every message says whether anything was changed,
    /// because that is the next thing a worried user needs to know.
    pub fn message(&self) -> String {
        match self {
            FileError::Refused(problem) => problem.message(),
            FileError::Io(detail) => {
                format!("The file could not be written, so nothing was changed: {detail}")
            }
        }
    }
}

/// Read one library document, by the store's own rules.
///
/// The version gate and the refusal to read a file that is not a library are
/// the store's, not a second copy of them: an import file is a library file, so
/// it is read exactly like one.
pub fn read_document(path: &Path) -> Result<Document, LibraryProblem> {
    let library = LibraryStore::new(path).load()?;
    let bytes = fs::read(path).map_err(|e| LibraryProblem::Unreadable {
        detail: e.to_string(),
    })?;
    let mut object = match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(object)) => object,
        // `load` has already refused anything that is not a library.
        _ => {
            return Err(LibraryProblem::Corrupt {
                detail: "the file is not a JSON object".to_string(),
            })
        }
    };
    for key in TYPED_KEYS {
        object.remove(key);
    }
    Ok(Document {
        library,
        rest: object,
    })
}

/// The library this build would read, as a document. A missing file is the
/// empty library, exactly as the store reads it.
fn current_document(store: &LibraryStore) -> Result<Document, FileError> {
    match read_document(store.path()) {
        Ok(document) => Ok(document),
        Err(LibraryProblem::Unreadable { .. }) if !store.path().exists() => Ok(Document::empty()),
        Err(problem) => Err(FileError::Refused(problem)),
    }
}

/// Write the whole library to `dest`.
///
/// The file this writes is a library file, so it re-imports to the same
/// library: that round trip is the point of an export.
///
/// The read and the write are one step in the domain, so an export is a copy of
/// one state of the library rather than of a state a save changed underneath it.
pub fn export(store: &LibraryStore, dest: &Path) -> Result<Document, FileError> {
    serialised(|domain| {
        // An unreadable library is never exported: a backup of bytes nobody can
        // read is not a backup, and pretending otherwise would hide the problem.
        let document = current_document(store)?;
        write_document(domain, dest, &document)?;
        Ok(document)
    })
}

/// What an import would do, counted so the user can be told before anything is
/// written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// Snapshots the file carries that the library does not have.
    pub snapshots_added: usize,
    /// Snapshots the library already has, which the import leaves alone.
    pub snapshots_conflicting: usize,
    /// Drafts the file carries that the library does not have.
    pub drafts_added: usize,
    /// Drafts the library already has, which the import leaves alone.
    pub drafts_conflicting: usize,
}

/// Read an import file and say what it would change. Nothing is written, so a
/// user who cancels after the preview leaves the library exactly as it was.
pub fn preview(store: &LibraryStore, source: &Path) -> Result<ImportPreview, FileError> {
    let (_, preview) = plan(store, source)?;
    Ok(preview)
}

/// Merge an import file into the library and write it.
///
/// Existing entries win: an import adds what is missing and never overwrites
/// what is already here, so a renamed Snapshot keeps its name.
///
/// The merge is decided and written in one step in the domain. Read outside it,
/// the merge would be based on a library a save had already moved past, and
/// writing it back would silently drop that save.
pub fn apply(store: &LibraryStore, source: &Path) -> Result<(Document, ImportPreview), FileError> {
    serialised(|domain| {
        let (merged, preview) = plan(store, source)?;
        write_document(domain, store.path(), &merged)?;
        Ok((merged, preview))
    })
}

fn plan(store: &LibraryStore, source: &Path) -> Result<(Document, ImportPreview), FileError> {
    let behind = current_document(store)?;
    let incoming = read_document(source).map_err(FileError::Refused)?;
    Ok(merge(&behind, &incoming))
}

/// Merge `incoming` into `behind`, reporting what changed and what was left
/// alone. Pure: the caller decides whether to write the result.
pub fn merge(behind: &Document, incoming: &Document) -> (Document, ImportPreview) {
    let mut seen: HashSet<String> = behind.library.snapshots.iter().map(snapshot_key).collect();
    let mut snapshots = behind.library.snapshots.clone();
    let mut snapshots_added = 0;
    let mut snapshots_conflicting = 0;
    for snapshot in &incoming.library.snapshots {
        // A file that carries the same Tag twice adds it once.
        if seen.insert(snapshot_key(snapshot)) {
            snapshots.push(snapshot.clone());
            snapshots_added += 1;
        } else {
            snapshots_conflicting += 1;
        }
    }

    let behind_drafts = &behind.library.drafts;
    let mut seen_drafts: HashSet<String> = behind_drafts.iter().map(draft_key).collect();
    let mut drafts: Vec<Draft> = behind_drafts.clone();
    let mut drafts_added = 0;
    let mut drafts_conflicting = 0;
    for draft in &incoming.library.drafts {
        if seen_drafts.insert(draft_key(draft)) {
            drafts.push(draft.clone());
            drafts_added += 1;
        } else {
            drafts_conflicting += 1;
        }
    }

    let mut merged = behind.library.clone();
    merged.snapshots = snapshots;
    merged.drafts = drafts;

    (
        Document {
            library: merged,
            rest: behind.rest.clone(),
        },
        ImportPreview {
            snapshots_added,
            snapshots_conflicting,
            drafts_added,
            drafts_conflicting,
        },
    )
}

/// What makes two Snapshots the same Snapshot.
///
/// The store's own Tag identity decides it, so an import conflicts with the
/// library on exactly the terms the library already uses. A raw-only read
/// carries no Tag identity to compare, so its own stable id stands in: importing
/// the same file twice must not duplicate it either.
fn snapshot_key(snapshot: &Snapshot) -> String {
    snapshot
        .tag_key()
        .unwrap_or_else(|| format!("id:{}", snapshot.id))
}

/// What makes two Drafts the same Draft.
///
/// A Draft carries no Tag identity, so the stable `id` the store generates is
/// its identity: the same id is the same Draft, and importing a file twice can
/// never add a second copy of one.
fn draft_key(draft: &Draft) -> String {
    format!("id:{}", draft.id)
}

/// Write one library document, atomically: staged beside the target and renamed
/// over it, so the file the user already had survives a failed write.
fn write_document(domain: &Domain, path: &Path, document: &Document) -> Result<(), FileError> {
    let bytes =
        serde_json::to_vec_pretty(&document.to_json()).map_err(|e| FileError::Io(e.to_string()))?;
    write_atomically(domain, path, &bytes).map_err(|e| FileError::Io(e.to_string()))
}

/// Write one file the user chose, atomically.
///
/// The same staging-and-rename a library export uses, composed out of
/// [`crate::atomic_file`], so a dump could not leave a half-written file where a
/// complete one was promised either. It is deliberately outside the library's
/// serialisation domain: the file is not the library, so a dump the user saved
/// would otherwise wait behind a library save it shares nothing with.
///
/// The two steps are written out rather than called through one helper because
/// the crate has no token-free "write this path" function to reach for — see that
/// module's own note. This is the one place that composes them outside the
/// library, and what it writes is a path the user picked in a save dialog.
pub fn write_text(path: &Path, text: &str) -> Result<(), FileError> {
    let staged = stage_bytes(path, text.as_bytes()).map_err(|e| FileError::Io(e.to_string()))?;
    commit_staged(&staged, path).map_err(|e| FileError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{HfFields, InsertOutcome, SCHEMA_VERSION};

    const CAPTURED_AT: &str = "2026-11-21T09:30:00.000Z";

    /// A 13.56 MHz read in the shape schema 2 kept: a UID and the raw reply.
    fn hf_fields(uid: &str) -> HfFields {
        HfFields {
            uid: uid.to_string(),
            raw: "00 01 02".to_string(),
            atqa: None,
            sak: None,
            card_type: None,
            capacity_bytes: None,
            ndef_formatted: None,
            records: None,
        }
    }

    /// A library with one read of each band, plus a raw-only read that carries
    /// no Tag identity at all: the three shapes an import has to cope with.
    fn populated_store(dir: &Path) -> (LibraryStore, Library) {
        let store = LibraryStore::new(dir.join("library.json"));
        let mut library = store.load().expect("a missing file is an empty library");
        match library.add_lf(0x55, 0x0084_8212, "00 01 01", CAPTURED_AT) {
            InsertOutcome::Added(_) => {}
            other => panic!("unexpected {other:?}"),
        }
        library.add_hf(hf_fields("04 A2 2B 3A 5C 6D 80"), CAPTURED_AT);
        library.add(Snapshot {
            id: "raw-1".to_string(),
            name: "Unreadable read".to_string(),
            note: "a read with nothing to decode".to_string(),
            kind: crate::library::Kind::LF,
            captured_at: CAPTURED_AT.to_string(),
            write_count: 3,
            identity: None,
            hf: None,
        });
        store.save(&library).expect("save");
        (store, library)
    }

    fn bytes_at(path: &Path) -> Vec<u8> {
        fs::read(path).expect("read the file under test")
    }

    fn library_at(path: &Path) -> Library {
        LibraryStore::new(path).load().expect("the file is a library")
    }

    // Slice A: an export is a library file, and re-imports to the same library.

    #[test]
    fn an_exported_library_imports_back_identically() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, original) = populated_store(dir.path());
        let dest = dir.path().join("backup.json");

        let exported = export(&store, &dest).expect("export");
        assert_eq!(
            exported.library, original,
            "the exported document is the library"
        );
        assert_eq!(
            library_at(&dest),
            original,
            "the export is itself a library file"
        );

        // The file round trip, on a machine that has never seen this library.
        let elsewhere = tempfile::tempdir().expect("temp dir");
        let fresh = LibraryStore::new(elsewhere.path().join("library.json"));
        assert_eq!(
            preview(&fresh, &dest).expect("preview"),
            ImportPreview {
                snapshots_added: 3,
                snapshots_conflicting: 0,
                drafts_added: 0,
                drafts_conflicting: 0,
            }
        );
        apply(&fresh, &dest).expect("import into an empty library");

        assert_eq!(library_at(fresh.path()), original);
        assert_eq!(
            bytes_at(fresh.path()),
            bytes_at(&dest),
            "importing an export into an empty library restores the file exactly"
        );
    }

    #[test]
    fn an_export_of_a_library_nobody_has_written_yet_is_an_empty_library() {
        let dir = tempfile::tempdir().expect("temp dir");
        // The library file does not exist: the user has never saved a Snapshot.
        let store = LibraryStore::new(dir.path().join("pm4-studio").join("library.json"));
        let dest = dir.path().join("backup.json");

        export(&store, &dest).expect("export");

        let exported = library_at(&dest);
        assert_eq!(exported, Library::empty());
        assert_eq!(exported.version, SCHEMA_VERSION);
    }

    #[test]
    fn an_export_leaves_only_the_file_it_wrote_behind() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, _) = populated_store(dir.path());
        let dest = dir.path().join("exports").join("backup.json");

        export(&store, &dest).expect("export to a directory that does not exist yet");

        let names: Vec<String> = fs::read_dir(dest.parent().expect("parent"))
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
            vec!["backup.json"],
            "the staging file must not survive an export"
        );
    }

    #[test]
    fn a_text_file_is_written_whole_and_leaves_no_staging_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let dest = dir.path().join("dumps").join("tag.txt");
        let text = "PM4 Studio — memory dump\nUID: 04 43 8A 01 22 09 03\n";

        write_text(&dest, text).expect("write a dump file");

        assert_eq!(bytes_at(&dest), text.as_bytes());
        let names: Vec<String> = fs::read_dir(dest.parent().expect("parent"))
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["tag.txt"], "the staging file is gone");
    }

    #[test]
    fn a_failed_text_write_leaves_the_file_that_was_already_there() {
        let dir = tempfile::tempdir().expect("temp dir");
        // A directory where the file should go cannot be renamed over.
        let dest = dir.path().join("tag.txt");
        fs::create_dir(&dest).expect("a directory in the way");

        let refused = write_text(&dest, "a dump");
        assert!(matches!(refused, Err(FileError::Io(_))), "got {refused:?}");
        assert!(dest.is_dir(), "what was there is still there");
    }

    #[test]
    fn a_dump_write_does_not_queue_behind_the_library_domain() {
        // Ticket 03 put every write to the library file inside one domain. A
        // dump is not the library file: it is a file the user chose, and making
        // it wait for a library save buys nothing, because the two have no
        // starting state in common. This test holds the domain and checks that a
        // dump written meanwhile finishes anyway.
        let dir = tempfile::tempdir().expect("temp dir");
        let dest = dir.path().join("tag.txt");

        let (held, domain_held) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel::<()>();
        let holder = std::thread::spawn(move || {
            crate::library::serialised(|_| {
                held.send(()).expect("the test is still waiting");
                let _ = released.recv();
            });
        });
        domain_held.recv().expect("the domain was taken");

        let written_path = dest.clone();
        let (done, finished) = std::sync::mpsc::channel();
        let writer = std::thread::spawn(move || {
            let _ = done.send(write_text(&written_path, "a dump").is_ok());
        });

        let outcome = finished.recv_timeout(std::time::Duration::from_secs(5));
        // Released either way, so a failure here cannot strand the domain for
        // every test that runs after it.
        release.send(()).expect("the holder is still there");
        holder.join().expect("the holder panicked");
        writer.join().expect("the writer panicked");

        assert_eq!(
            outcome,
            Ok(true),
            "a dump write waited for the library's lock and failed to land"
        );
        assert_eq!(bytes_at(&dest), b"a dump");
    }

    // Slice B: the preview says what would happen and writes nothing.

    #[test]
    fn a_preview_counts_what_would_be_added_and_changes_nothing() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, original) = populated_store(dir.path());
        let before = bytes_at(store.path());

        // A file with one Snapshot the library has and two it does not.
        let source = dir.path().join("incoming.json");
        let mut incoming = Library::empty();
        incoming.add_lf(0x55, 0x0084_8212, "00 01 01", CAPTURED_AT);
        incoming.add_lf(0x55, 0x0053_C7B3, "00 01 01", CAPTURED_AT);
        incoming.add_hf(hf_fields("04 A2 2B 3A 5C 6D 81"), CAPTURED_AT);
        LibraryStore::new(&source)
            .save(&incoming)
            .expect("write the import file");

        let counted = preview(&store, &source).expect("preview");

        assert_eq!(
            counted,
            ImportPreview {
                snapshots_added: 2,
                snapshots_conflicting: 1,
                drafts_added: 0,
                drafts_conflicting: 0,
            }
        );
        assert_eq!(
            bytes_at(store.path()),
            before,
            "a preview writes nothing at all"
        );
        assert_eq!(library_at(store.path()), original);
    }

    #[test]
    fn cancelling_an_import_leaves_the_library_untouched() {
        // Cancelling is the preview being the last thing the user asked for.
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, original) = populated_store(dir.path());
        let source = dir.path().join("incoming.json");
        let mut incoming = Library::empty();
        incoming.add_lf(0x55, 0x0053_C7B3, "00 01 01", CAPTURED_AT);
        LibraryStore::new(&source)
            .save(&incoming)
            .expect("write the import file");

        let counted = preview(&store, &source).expect("preview");
        assert_eq!(counted.snapshots_added, 1);
        // The user cancels: nothing else is called.
        assert_eq!(library_at(store.path()), original);
    }

    // Slice C: applying merges, and neither duplicates nor destroys.

    #[test]
    fn importing_adds_what_is_missing_and_keeps_what_is_here() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, original) = populated_store(dir.path());
        store
            .save(&{
                let mut renamed = original.clone();
                renamed.rename("55 00 84 82 12", "Front door");
                renamed
            })
            .expect("rename one Snapshot first");
        let before = library_at(store.path());

        let source = dir.path().join("incoming.json");
        let mut incoming = Library::empty();
        // The same Tag as the library has, under a different name and time.
        incoming.add_lf(0x55, 0x0084_8212, "00 01 01", "2026-12-01T00:00:00.000Z");
        renamed_last(&mut incoming, "Garage door");
        incoming.add_lf(0x55, 0x0053_C7B3, "00 01 01", CAPTURED_AT);
        LibraryStore::new(&source)
            .save(&incoming)
            .expect("write the import file");

        let (merged, counted) = apply(&store, &source).expect("import");

        assert_eq!(counted.snapshots_added, 1);
        assert_eq!(counted.snapshots_conflicting, 1);

        let after = library_at(store.path());
        assert_eq!(after, merged.library);
        assert_eq!(
            after.snapshots.len(),
            4,
            "one Snapshot was added, none was duplicated"
        );
        let kept = after
            .snapshots
            .iter()
            .find(|s| s.id == "55 00 84 82 12")
            .expect("the existing Snapshot is still here");
        assert_eq!(
            kept.name, "Front door",
            "an import never overwrites what the user already had"
        );
        assert_eq!(kept.captured_at, CAPTURED_AT, "nor when it was read");
        assert!(
            before.snapshots.iter().all(|s| after.snapshots.contains(s)),
            "every Snapshot that was here is still here, unchanged"
        );
        assert!(
            after.snapshots.iter().any(|s| s.id == "55 00 53 C7 B3"),
            "the missing Snapshot was added"
        );
    }

    fn renamed_last(library: &mut Library, name: &str) {
        let id = library
            .snapshots
            .last()
            .expect("a Snapshot to rename")
            .id
            .clone();
        assert!(library.rename(&id, name));
    }

    #[test]
    fn importing_the_same_file_twice_does_not_duplicate_anything() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        let source = dir.path().join("incoming.json");
        let mut incoming = Library::empty();
        incoming.add_lf(0x55, 0x0084_8212, "00 01 01", CAPTURED_AT);
        incoming.add(Snapshot {
            id: "raw-1".to_string(),
            name: "Unreadable read".to_string(),
            note: String::new(),
            kind: crate::library::Kind::LF,
            captured_at: CAPTURED_AT.to_string(),
            write_count: 0,
            identity: None,
            hf: None,
        });
        LibraryStore::new(&source)
            .save(&incoming)
            .expect("write the import file");

        apply(&store, &source).expect("first import");
        let once = library_at(store.path());
        assert_eq!(once.snapshots.len(), 2);

        let (_, counted) = apply(&store, &source).expect("second import");
        assert_eq!(
            counted,
            ImportPreview {
                snapshots_added: 0,
                snapshots_conflicting: 2,
                drafts_added: 0,
                drafts_conflicting: 0,
            }
        );
        assert_eq!(
            library_at(store.path()),
            once,
            "a second import of the same file changes nothing"
        );
    }

    #[test]
    fn a_file_that_carries_one_tag_twice_adds_it_once() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        let source = dir.path().join("incoming.json");
        let mut incoming = Library::empty();
        // A hand-edited file: the same read of the same Tag, written twice.
        match incoming.add_lf(0x55, 0x0084_8212, "00 01 01", CAPTURED_AT) {
            InsertOutcome::Added(_) => {}
            other => panic!("unexpected {other:?}"),
        }
        let duplicate = incoming.snapshots[0].clone();
        incoming.snapshots.push(duplicate);
        LibraryStore::new(&source)
            .save(&incoming)
            .expect("write the import file");

        let (_, counted) = apply(&store, &source).expect("import");

        assert_eq!(counted.snapshots_added, 1);
        assert_eq!(counted.snapshots_conflicting, 1);
        assert_eq!(library_at(store.path()).snapshots.len(), 1);
    }

    // Slice D: a file this build must refuse, leaving the library alone.

    #[test]
    fn a_malformed_import_file_is_refused_and_the_library_is_untouched() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, original) = populated_store(dir.path());
        let before = bytes_at(store.path());

        let source = dir.path().join("torn.json");
        fs::write(&source, b"{\"version\":1,\"snapshots\":[{\"id\":\"55 00").expect("write");

        let refused = apply(&store, &source).expect_err("a torn file is not importable");
        assert!(
            matches!(
                refused,
                FileError::Refused(LibraryProblem::Corrupt { .. })
            ),
            "got {refused:?}"
        );
        assert!(
            refused.message().contains("has not been changed"),
            "{}",
            refused.message()
        );
        assert_eq!(
            bytes_at(store.path()),
            before,
            "the library is left byte for byte"
        );
        assert_eq!(library_at(store.path()), original);
    }

    #[test]
    fn an_import_from_a_newer_schema_is_refused_rather_than_mangled() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, original) = populated_store(dir.path());
        let source = dir.path().join("from-the-future.json");
        let newer = br#"{"version":99,"snapshots":[],"drafts":[]}"#.to_vec();
        fs::write(&source, &newer).expect("write");

        let refused = apply(&store, &source).expect_err("a newer file is not imported");
        assert_eq!(
            refused,
            FileError::Refused(LibraryProblem::NewerVersion {
                found: 99,
                supported: SCHEMA_VERSION
            })
        );
        assert_eq!(library_at(store.path()), original);
        assert_eq!(bytes_at(&source), newer, "the import file is not rewritten");
    }

    #[test]
    fn an_import_from_a_missing_file_is_refused_and_the_library_is_untouched() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, original) = populated_store(dir.path());

        let refused = preview(&store, &dir.path().join("not-here.json"))
            .expect_err("there is nothing to import");
        assert!(
            matches!(
                refused,
                FileError::Refused(LibraryProblem::Unreadable { .. })
            ),
            "got {refused:?}"
        );
        assert_eq!(library_at(store.path()), original);
    }

    #[test]
    fn importing_into_a_library_that_cannot_be_read_is_refused() {
        // The library file is not a library: an import must not become the
        // clean start that the store itself refuses to make.
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        let torn = b"{\"version\":1,\"snapshots\":[".to_vec();
        fs::write(store.path(), &torn).expect("write");

        let source = dir.path().join("incoming.json");
        LibraryStore::new(&source)
            .save(&Library::empty())
            .expect("write the import file");

        let refused = apply(&store, &source).expect_err("refused");
        assert!(
            matches!(
                refused,
                FileError::Refused(LibraryProblem::Corrupt { .. })
            ),
            "got {refused:?}"
        );
        assert_eq!(bytes_at(store.path()), torn, "left byte for byte");
    }

    #[test]
    fn an_export_of_a_library_that_cannot_be_read_is_refused() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        fs::write(store.path(), br#"{"version":99,"snapshots":[]}"#).expect("write");
        let dest = dir.path().join("backup.json");

        let refused = export(&store, &dest).expect_err("refused");
        assert!(matches!(refused, FileError::Refused(_)), "got {refused:?}");
        assert!(
            !dest.exists(),
            "a refused export does not leave a half-backup behind"
        );
    }

    // Slice E: Drafts, which are in this build's schema and travel with the
    // library on the same terms as the Snapshots.

    fn draft(id: &str, name: &str) -> Draft {
        Draft {
            id: id.to_string(),
            name: name.to_string(),
            updated_at: CAPTURED_AT.to_string(),
            records: Vec::new(),
        }
    }

    /// Write a real library file (through the store, so it is byte-for-byte the
    /// file the app itself writes) that carries these Drafts.
    fn library_file_with_drafts(path: &Path, drafts: Vec<Draft>) -> Library {
        let mut library = Library::empty();
        library.drafts = drafts;
        LibraryStore::new(path)
            .save(&library)
            .expect("write a library file with Drafts");
        library
    }

    #[test]
    fn drafts_come_along_with_an_export_and_survive_an_import() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        let original = library_file_with_drafts(
            store.path(),
            vec![draft("draft-1", "Lobby"), draft("draft-2", "Car park")],
        );

        let dest = dir.path().join("backup.json");
        let exported = export(&store, &dest).expect("export");
        assert_eq!(exported.draft_count(), 2, "the export carries the Drafts");

        // The export is a library file in the same versioned schema, so the
        // store reads the Drafts back out of it rather than a parallel format.
        let reread = library_at(&dest);
        assert_eq!(reread.drafts, original.drafts, "the Drafts are written out");
        let json: Value = serde_json::from_slice(&bytes_at(&dest)).expect("json");
        assert_eq!(json["drafts"][0]["name"], "Lobby");
        assert_eq!(json["drafts"][0]["id"], "draft-1");
        assert_eq!(json["drafts"][0]["updatedAt"], CAPTURED_AT);

        let elsewhere = tempfile::tempdir().expect("temp dir");
        let fresh = LibraryStore::new(elsewhere.path().join("library.json"));
        let counted = preview(&fresh, &dest).expect("preview");
        assert_eq!(
            counted,
            ImportPreview {
                snapshots_added: 0,
                snapshots_conflicting: 0,
                drafts_added: 2,
                drafts_conflicting: 0,
            },
            "the preview counts Drafts before anything is written"
        );

        apply(&fresh, &dest).expect("import");
        assert_eq!(
            library_at(fresh.path()).drafts,
            original.drafts,
            "the Drafts arrive unchanged"
        );
    }

    #[test]
    fn draft_records_are_carried_through_an_export_and_an_import() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        let mut written = draft("draft-1", "Lobby");
        written.records = vec![
            crate::library::DraftRecord {
                kind: "text".to_string(),
                fields: [("text".to_string(), "Front door".to_string())]
                    .into_iter()
                    .collect(),
            },
            crate::library::DraftRecord {
                kind: "uri".to_string(),
                fields: [("uri".to_string(), "https://example.test/a".to_string())]
                    .into_iter()
                    .collect(),
            },
        ];
        let original = library_file_with_drafts(store.path(), vec![written.clone()]);

        let dest = dir.path().join("backup.json");
        export(&store, &dest).expect("export");
        assert_eq!(library_at(&dest).drafts, original.drafts);

        let elsewhere = tempfile::tempdir().expect("temp dir");
        let fresh = LibraryStore::new(elsewhere.path().join("library.json"));
        apply(&fresh, &dest).expect("import");
        assert_eq!(
            library_at(fresh.path()).drafts[0].records,
            written.records,
            "a Draft's Records are kept, in order, with their fields"
        );
    }

    #[test]
    fn importing_drafts_the_library_already_has_adds_no_copy() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        library_file_with_drafts(store.path(), vec![draft("draft-1", "Lobby")]);
        let before = bytes_at(store.path());

        let source = dir.path().join("incoming.json");
        library_file_with_drafts(
            &source,
            vec![draft("draft-1", "Lobby renamed elsewhere"), draft("draft-2", "Car park")],
        );

        let (_, counted) = apply(&store, &source).expect("import");
        assert_eq!(counted.drafts_added, 1);
        assert_eq!(counted.drafts_conflicting, 1);

        let after = library_at(store.path());
        assert_eq!(after.drafts.len(), 2);
        // The Draft that was already here is not replaced by the imported copy.
        assert_eq!(after.drafts[0].id, "draft-1");
        assert_eq!(
            after.drafts[0].name, "Lobby",
            "an import never overwrites a Draft that is already here"
        );
        assert_ne!(
            bytes_at(store.path()),
            before,
            "the new Draft was written, which is the only change"
        );
    }

    #[test]
    fn an_import_without_drafts_does_not_destroy_the_ones_already_here() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        let mut library = library_file_with_drafts(store.path(), vec![draft("draft-1", "Lobby")]);
        library.add_lf(0x55, 0x0084_8212, "00 01 01", CAPTURED_AT);
        store.save(&library).expect("save");

        let source = dir.path().join("incoming.json");
        let mut incoming = Library::empty();
        incoming.add_lf(0x55, 0x0053_C7B3, "00 01 01", CAPTURED_AT);
        LibraryStore::new(&source)
            .save(&incoming)
            .expect("write the import file");

        let (_, counted) = apply(&store, &source).expect("import");
        assert_eq!(counted.drafts_added, 0);
        assert_eq!(counted.snapshots_added, 1);

        let after = library_at(store.path());
        assert_eq!(
            after.drafts,
            vec![draft("draft-1", "Lobby")],
            "a file with no Drafts leaves the Drafts already here untouched"
        );
        assert_eq!(after.snapshots.len(), 2);
    }

    #[test]
    fn a_hand_edited_file_with_a_draft_this_build_cannot_read_is_refused() {
        // Drafts are typed now, so a Draft missing the fields the store writes
        // is exactly as unreadable as any other malformed library. It must be
        // refused with the library left alone, not merged with a guessed shape.
        let dir = tempfile::tempdir().expect("temp dir");
        let (store, original) = populated_store(dir.path());
        let before = bytes_at(store.path());

        let source = dir.path().join("incoming.json");
        fs::write(
            &source,
            br#"{"version":1,"snapshots":[],"drafts":[{"name":"No id"}]}"#,
        )
        .expect("write");

        let refused = apply(&store, &source).expect_err("refused");
        assert!(
            matches!(refused, FileError::Refused(LibraryProblem::Corrupt { .. })),
            "got {refused:?}"
        );
        assert_eq!(bytes_at(store.path()), before, "left byte for byte");
        assert_eq!(library_at(store.path()), original);
    }

    // Ticket 03: one serialisation domain for the library file.
    //
    // The store's own write path and the import path each replace the whole
    // file. Each is atomic on its own and the pair is not: two writes that
    // overlap can each read the same starting library and each rename a file
    // holding only its own change, so one whole update is lost and neither path
    // reports anything, because from either side the write succeeded.

    /// A Draft save, as the app performs it: one step in the domain that reads
    /// the library, adds the Draft and writes the library back.
    fn save_a_draft(store: &LibraryStore, name: &str) {
        store
            .update(|library| {
                library.add_draft(name, CAPTURED_AT);
            })
            .expect("save a Draft");
    }

    /// A Snapshot save, as the app performs it when a read is saved.
    fn save_a_snapshot(store: &LibraryStore, data32: u32) {
        store
            .update(|library| {
                library.add_lf(0x55, data32, "00 01 01", CAPTURED_AT);
            })
            .expect("save a Snapshot");
    }

    #[test]
    fn a_draft_save_a_snapshot_save_and_an_import_that_overlap_all_land() {
        const ROUNDS: u32 = 20;
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");

        // What the import brings: one Snapshot per imported read, each on a
        // different Tag, so a lost import is a Snapshot that never arrives.
        let source = dir.path().join("incoming.json");
        let mut incoming = Library::empty();
        for round in 0..ROUNDS {
            incoming.add_lf(0x56, 0x0080_0000 + round, "00 01 01", CAPTURED_AT);
        }
        LibraryStore::new(&source)
            .save(&incoming)
            .expect("write the import file");

        // Every write the app can make, launched at once, each from its own
        // handle on the same file — which is exactly how the app calls them.
        let mut handles = Vec::new();
        for round in 0..ROUNDS {
            let named = format!("Draft {round}");
            let draft_path = path.clone();
            handles.push(std::thread::spawn(move || {
                save_a_draft(&LibraryStore::new(&draft_path), &named);
            }));

            let snapshot_path = path.clone();
            handles.push(std::thread::spawn(move || {
                save_a_snapshot(&LibraryStore::new(&snapshot_path), 0x0200_0000 + round);
            }));

            let import_path = path.clone();
            let import_source = source.clone();
            handles.push(std::thread::spawn(move || {
                apply(&LibraryStore::new(&import_path), &import_source).expect("import");
            }));
        }

        // A reader alongside them: the file must parse at every moment, not
        // only once the writers have finished.
        let writing = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let reader_writing = std::sync::Arc::clone(&writing);
        let reader_path = path.clone();
        let reader = std::thread::spawn(move || {
            let store = LibraryStore::new(&reader_path);
            while reader_writing.load(std::sync::atomic::Ordering::SeqCst) {
                if let Err(problem) = store.load() {
                    panic!("a reader saw a file that is not a library: {problem:?}");
                }
            }
        });

        for handle in handles {
            handle.join().expect("a write path panicked");
        }
        writing.store(false, std::sync::atomic::Ordering::SeqCst);
        reader.join().expect("the reader saw a torn file");

        // The file still parses, and it holds every update: each write is based
        // on the file as it was when that write began, so no save can have
        // replaced another's change. Every Tag here is distinct, so a count is
        // an identity check on what survived.
        let after = library_at(&path);
        assert_eq!(
            after.drafts.len(),
            ROUNDS as usize,
            "every Draft save must land, got {:?}",
            after.drafts.iter().map(|d| &d.name).collect::<Vec<_>>()
        );
        assert_eq!(
            after.snapshots.len(),
            2 * ROUNDS as usize,
            "every saved and every imported Snapshot must land"
        );

        // The atomic replace is unchanged: the staging file is gone.
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
        assert!(
            names.iter().all(|name| !name.ends_with(".tmp")),
            "a staging file survived: {names:?}"
        );
    }
}
