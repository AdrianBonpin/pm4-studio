//! Exporting the library to a file the user chooses, and importing one back.
//!
//! One schema, one set of rules: an export *is* a library document, so the
//! store's own reading rules decide whether a file may be imported at all (see
//! `library.rs`), and a file from a newer schema is refused rather than
//! mangled. Import merges — it adds what is missing and leaves what is already
//! here exactly as it is — so the two ways a library can be lost, silently
//! duplicating an entry and silently destroying one, are both closed.
//!
//! Collections this build does not understand are carried verbatim: Drafts are
//! not in the schema yet, and whether they are or not, the key a file carries
//! is exported and merged rather than dropped.
//!
//! Nothing here touches the Reader, so every test runs against a real temp
//! directory with no hardware attached.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::library::{Library, LibraryProblem, LibraryStore, Snapshot};

/// Suffix of the staging file a document write renames into place.
///
/// It deliberately differs from the store's own staging suffix: an export or an
/// import must never stage bytes in the same file a library save is about to
/// rename into place, or the two could commit each other's half-written bytes.
const TEMP_SUFFIX: &str = ".document.tmp";

/// Two document writes must not stage into one temp file at the same time.
static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Top-level keys the typed half of a library owns.
const TYPED_KEYS: [&str; 2] = ["version", "snapshots"];

/// The collection Drafts live in. Kept as a name, not as a type: this build may
/// not have Drafts in its schema yet, and a name works either way.
const DRAFTS_KEY: &str = "drafts";

/// One library document as a file holds it.
///
/// Snapshots are typed because this build understands them. Everything else is
/// kept exactly as it was read, so a collection this build has never heard of
/// survives an export and an import untouched.
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

    /// The Drafts the document carries, when the file carries any.
    pub fn drafts(&self) -> Option<&Vec<Value>> {
        self.rest.get(DRAFTS_KEY).and_then(Value::as_array)
    }

    /// How many Drafts the document carries.
    pub fn draft_count(&self) -> usize {
        self.drafts().map(Vec::len).unwrap_or(0)
    }

    /// The document as it is written to a file.
    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("version".to_string(), Value::from(self.library.version));
        object.insert(
            "snapshots".to_string(),
            serde_json::to_value(&self.library.snapshots)
                .expect("a Snapshot is always serialisable"),
        );
        for (key, value) in &self.rest {
            object.insert(key.clone(), value.clone());
        }
        Value::Object(object)
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
pub fn export(store: &LibraryStore, dest: &Path) -> Result<Document, FileError> {
    // An unreadable library is never exported: a backup of bytes nobody can
    // read is not a backup, and pretending otherwise would hide the problem.
    let document = current_document(store)?;
    write_document(dest, &document)?;
    Ok(document)
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
pub fn apply(store: &LibraryStore, source: &Path) -> Result<(Document, ImportPreview), FileError> {
    let (merged, preview) = plan(store, source)?;
    write_document(store.path(), &merged)?;
    Ok((merged, preview))
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

    let behind_drafts = behind.drafts();
    let mut seen_drafts: HashSet<String> = behind_drafts
        .into_iter()
        .flatten()
        .map(draft_key)
        .collect();
    let mut drafts: Vec<Value> = behind_drafts.cloned().unwrap_or_default();
    let mut drafts_added = 0;
    let mut drafts_conflicting = 0;
    for draft in incoming.drafts().into_iter().flatten() {
        if seen_drafts.insert(draft_key(draft)) {
            drafts.push(draft.clone());
            drafts_added += 1;
        } else {
            drafts_conflicting += 1;
        }
    }

    // The Drafts key is written only when one of the two documents carried it:
    // a library without Drafts must not acquire an empty collection it never had.
    let mut rest = behind.rest.clone();
    if behind.drafts().is_some() || incoming.drafts().is_some() {
        rest.insert(DRAFTS_KEY.to_string(), Value::Array(drafts));
    }

    let mut merged = behind.library.clone();
    merged.snapshots = snapshots;

    (
        Document {
            library: merged,
            rest,
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
/// A Draft carries no Tag identity, so the stable `id` entries are stored with
/// is its identity. A Draft with no id can only be compared with its own bytes,
/// which still keeps a re-import from adding a second copy of the same thing.
fn draft_key(draft: &Value) -> String {
    match draft.get("id").and_then(Value::as_str) {
        Some(id) => format!("id:{id}"),
        None => format!("bytes:{draft}"),
    }
}

/// Write one library document, atomically: staged beside the target and renamed
/// over it, so the file the user already had survives a failed write.
fn write_document(path: &Path, document: &Document) -> Result<(), FileError> {
    let _staged = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let bytes = serde_json::to_vec_pretty(&document.to_json()).map_err(|e| FileError::Io(e.to_string()))?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| {
                FileError::Io(format!("could not create {}: {e}", parent.display()))
            })?;
        }
    }
    let staged = staging_path(path);
    write_and_flush(&staged, &bytes).map_err(|e| FileError::Io(e.to_string()))?;
    fs::rename(&staged, path).map_err(|e| FileError::Io(e.to_string()))?;
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
    // leave an empty file where a complete one was promised.
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{InsertOutcome, SCHEMA_VERSION};

    const CAPTURED_AT: &str = "2026-11-21T09:30:00.000Z";

    /// A library with one read of each band, plus a raw-only read that carries
    /// no Tag identity at all: the three shapes an import has to cope with.
    fn populated_store(dir: &Path) -> (LibraryStore, Library) {
        let store = LibraryStore::new(dir.join("library.json"));
        let mut library = store.load().expect("a missing file is an empty library");
        match library.add_lf(0x55, 0x0084_8212, "00 01 01", CAPTURED_AT) {
            InsertOutcome::Added(_) => {}
            other => panic!("unexpected {other:?}"),
        }
        library.add_hf("04 A2 2B 3A 5C 6D 80", "00 01 02", CAPTURED_AT);
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
        incoming.add_hf("04 A2 2B 3A 5C 6D 81", "00 01 03", CAPTURED_AT);
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

    // Slice E: Drafts, which this build's schema may not have yet.

    /// Write a library file that carries a `drafts` collection by hand, the way
    /// a build that knows about Drafts would. This build has no Draft type, and
    /// must carry the collection anyway.
    fn library_file_with_drafts(path: &Path, snapshots: &str, drafts: &str) {
        let json = format!(
            r#"{{
  "version": 1,
  "snapshots": [{snapshots}],
  "drafts": [{drafts}]
}}"#
        );
        fs::write(path, json).expect("write a library file with Drafts");
    }

    fn draft(id: &str, name: &str) -> String {
        format!(r#"{{"id":"{id}","name":"{name}","records":[]}}"#)
    }

    #[test]
    fn drafts_come_along_with_an_export_and_survive_an_import() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        library_file_with_drafts(
            store.path(),
            "",
            &format!("{},{}", draft("draft-1", "Lobby"), draft("draft-2", "Car park")),
        );

        let dest = dir.path().join("backup.json");
        let exported = export(&store, &dest).expect("export");
        assert_eq!(exported.draft_count(), 2, "the export carries the Drafts");
        assert_eq!(read_document(&dest).expect("read").draft_count(), 2);

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
            read_document(fresh.path()).expect("read").drafts(),
            read_document(&dest).expect("read").drafts(),
            "the Drafts arrive unchanged"
        );
    }

    #[test]
    fn importing_drafts_the_library_already_has_adds_no_copy() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        library_file_with_drafts(store.path(), "", &draft("draft-1", "Lobby"));
        let before = bytes_at(store.path());

        let source = dir.path().join("incoming.json");
        library_file_with_drafts(
            &source,
            "",
            &format!("{},{}", draft("draft-1", "Lobby"), draft("draft-2", "Car park")),
        );

        let (_, counted) = apply(&store, &source).expect("import");
        assert_eq!(counted.drafts_added, 1);
        assert_eq!(counted.drafts_conflicting, 1);

        let after = read_document(store.path()).expect("read");
        assert_eq!(after.draft_count(), 2);
        // The Draft that was already here is not replaced by the imported copy.
        let kept = &after.drafts().expect("drafts")[0];
        assert_eq!(kept["name"], "Lobby");
        assert_ne!(
            bytes_at(store.path()),
            before,
            "the new Draft was written, which is the only change"
        );
    }

    #[test]
    fn a_library_without_drafts_does_not_gain_them_from_an_import() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        let mut library = Library::empty();
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
        assert!(
            read_document(store.path()).expect("read").drafts().is_none(),
            "an absent collection stays absent instead of being invented"
        );
    }

    #[test]
    fn a_draft_with_no_id_is_compared_with_its_own_bytes() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = LibraryStore::new(dir.path().join("library.json"));
        library_file_with_drafts(store.path(), "", r#"{"name":"No id","records":[]}"#);

        let source = dir.path().join("incoming.json");
        library_file_with_drafts(&source, "", r#"{"name":"No id","records":[]}"#);

        let (_, counted) = apply(&store, &source).expect("import");
        assert_eq!(counted.drafts_added, 0);
        assert_eq!(counted.drafts_conflicting, 1);
        assert_eq!(read_document(store.path()).expect("read").draft_count(), 1);
    }
}
