//! One-time migration of the old webview saved-tag store into the library file.
//!
//! The old store was a `localStorage` array; the library is a JSON file this
//! process owns. The webview reads the old store and hands the parsed entries
//! here, and this module maps them onto Snapshots. The crossing is where a
//! stored read can quietly lose a field, so every field of the old shape is
//! mapped explicitly:
//!
//! | old store  | Snapshot                                                        |
//! |------------|-----------------------------------------------------------------|
//! | `id`       | `id`, but only while it agrees with the Identity it decodes from |
//! | `customer` | `identity.customer` (`0` when the oldest store recorded none)   |
//! | `data32`   | `identity.data32`                                               |
//! | `name`     | `name`                                                          |
//! | `savedAt`  | `capturedAt`                                                    |
//! | `note`     | `note` (later builds recorded one)                              |
//!
//! Two Snapshot fields have no source in the old store and are left honest
//! rather than invented: `identity.raw` (the old store never kept payload bytes)
//! and `writeCount` (it never counted writes). Both are reported in [`MISSING_FIELDS`].
//!
//! A stored read that cannot be decoded into an Identity — no `data32`, a
//! `data32` that is not a whole number, wider than facility and card can hold, or
//! zero (a blanked Tag) — is preserved as a raw-only Snapshot: no Identity, no
//! UID, and the entry's own bytes in its note. The library page already shows
//! such a Snapshot as "raw only".
//!
//! **Idempotence.** Migration runs only while the library file does not exist.
//! A committed file is never migrated into again, and a failed run leaves no file
//! behind (the store replaces atomically), so the next launch starts over rather
//! than appending. Within one run, reads are deduplicated on the store's
//! `tag_key`, so the same Tag stored twice yields one Snapshot.
//!
//! Nothing here touches the Reader, so every test runs against a real temp
//! directory with no hardware attached.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::identity::{Identity, MAX_DATA32};
use crate::library::{
    serialised, Domain, IdentityFields, InsertOutcome, Kind, Library, LibraryProblem, LibraryStore,
    SaveError, Snapshot,
};

/// The keys the old store wrote. A key outside this list has no home in a
/// Snapshot, so it is reported rather than dropped in silence.
const LEGACY_KEYS: [&str; 6] = ["id", "customer", "data32", "name", "savedAt", "note"];

/// Snapshot fields the old store never recorded. A migrated Snapshot has no
/// payload bytes and no confirmed copies, and says so instead of claiming either.
pub const MISSING_FIELDS: [&'static str; 2] = ["identity.raw", "writeCount"];

/// Whether migration ran, and why not when it did not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationStatus {
    /// The old store's reads were written to a new library file.
    Migrated,
    /// A library file already exists, so migration did not run.
    LibraryExists,
    /// The old store held nothing to migrate, so no file was created.
    NothingToMigrate,
}

impl MigrationStatus {
    /// The name the webview reads, which is also what the log line says.
    pub fn as_str(self) -> &'static str {
        match self {
            MigrationStatus::Migrated => "migrated",
            MigrationStatus::LibraryExists => "libraryExists",
            MigrationStatus::NothingToMigrate => "nothingToMigrate",
        }
    }
}

/// Why migration did not happen, or did not finish.
#[derive(Debug, Clone, PartialEq)]
pub enum MigrationError {
    /// The file on disk is not one this build may read or replace, and was left alone.
    Refused(LibraryProblem),
    /// The library could not be written; the file on disk is unchanged and the
    /// old store is untouched, so the next launch migrates again.
    Io(String),
}

/// What one migration run did.
#[derive(Debug, Clone, PartialEq)]
pub struct Migration {
    pub status: MigrationStatus,
    /// The library as it stands after the run.
    pub library: Library,
    /// Snapshots this run wrote.
    pub migrated: usize,
    /// Of those, the ones preserved without an Identity because they could not be decoded.
    pub raw_only: usize,
    /// Stored reads the library already held, so they were not added twice.
    pub already_present: usize,
    /// Array elements that were not stored reads at all, so there was nothing to preserve.
    pub skipped: usize,
    /// Snapshot fields the old store never recorded.
    pub missing: Vec<&'static str>,
    /// Old-store keys this app has no home for.
    pub unmapped: Vec<String>,
}

impl Migration {
    /// A run that did not touch the file.
    fn untouched(status: MigrationStatus, library: Library) -> Self {
        Self {
            status,
            library,
            migrated: 0,
            raw_only: 0,
            already_present: 0,
            skipped: 0,
            missing: MISSING_FIELDS.to_vec(),
            unmapped: Vec::new(),
        }
    }
}

/// One stored read, mapped onto a Snapshot.
struct Mapped {
    snapshot: Snapshot,
    raw_only: bool,
}

/// Migrate the old store's stored reads into the library, once.
///
/// `now` stamps a stored read the oldest store saved without a timestamp, the way
/// the old loader did when it read one.
pub fn migrate(
    store: &LibraryStore,
    entries: &[Value],
    now: &str,
) -> Result<Migration, MigrationError> {
    // Whether the file exists, what would go into it, and the write itself are
    // one step in the serialisation domain: a file that appeared between the
    // check and the write would be replaced by a migration that never saw it.
    serialised(|domain| migrate_in(domain, store, entries, now))
}

fn migrate_in(
    domain: &Domain,
    store: &LibraryStore,
    entries: &[Value],
    now: &str,
) -> Result<Migration, MigrationError> {
    // The criterion is the file, not a flag beside it: a file that exists is
    // either this migration's committed output or the user's own library, and
    // neither may be written into a second time.
    if store.path().exists() {
        let library = store.load().map_err(MigrationError::Refused)?;
        return Ok(Migration::untouched(
            MigrationStatus::LibraryExists,
            library,
        ));
    }

    let mut library = Library::empty();
    let mut migrated = 0;
    let mut raw_only = 0;
    let mut already_present = 0;
    let mut skipped = 0;
    let mut unmapped = BTreeSet::new();

    for (index, entry) in entries.iter().enumerate() {
        let Some(object) = entry.as_object() else {
            // Not a stored read at all: a null or a bare value in the array.
            // There is nothing to preserve, and it is counted rather than hidden.
            skipped += 1;
            continue;
        };
        for key in object.keys() {
            if !LEGACY_KEYS.contains(&key.as_str()) {
                unmapped.insert(key.clone());
            }
        }
        let mapped = map_stored_read(object, index, now, &library, &mut unmapped);
        match library.add(mapped.snapshot) {
            InsertOutcome::Added(_) => {
                migrated += 1;
                if mapped.raw_only {
                    raw_only += 1;
                }
            }
            InsertOutcome::Duplicate(_) => already_present += 1,
        }
    }

    // Nothing to write means nothing to create: an empty library file would end
    // migration for good, because from then on the file exists.
    if migrated == 0 {
        return Ok(Migration {
            status: MigrationStatus::NothingToMigrate,
            library: Library::empty(),
            migrated: 0,
            raw_only: 0,
            already_present,
            skipped,
            missing: MISSING_FIELDS.to_vec(),
            unmapped: unmapped.into_iter().collect(),
        });
    }

    store.replace(domain, &library).map_err(|e| match e {
        SaveError::Refused(problem) => MigrationError::Refused(problem),
        SaveError::Io(detail) => MigrationError::Io(detail),
    })?;

    Ok(Migration {
        status: MigrationStatus::Migrated,
        library,
        migrated,
        raw_only,
        already_present,
        skipped,
        missing: MISSING_FIELDS.to_vec(),
        unmapped: unmapped.into_iter().collect(),
    })
}

/// Map one stored read: an Identity when its fields decode, a preserved payload
/// when they do not.
fn map_stored_read(
    object: &Map<String, Value>,
    index: usize,
    now: &str,
    library: &Library,
    unmapped: &mut BTreeSet<String>,
) -> Mapped {
    let captured_at = object
        .get("savedAt")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| now.to_string());
    let note = object
        .get("note")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let stored_id = object.get("id").and_then(Value::as_str);

    let decoded = match (
        customer_byte(object.get("customer")),
        data32_field(object.get("data32")),
    ) {
        (Some(customer), Some(data32)) => Some(Identity { customer, data32 }),
        _ => None,
    };

    if let Some(identity) = decoded {
        let id = identity.id();
        // The Identity is what a write would reproduce, so it is authoritative;
        // a stored id that disagrees has no home and is reported.
        if stored_id.is_some_and(|text| text != id) {
            unmapped.insert("id".to_string());
        }
        return Mapped {
            snapshot: Snapshot {
                id,
                name,
                note,
                kind: Kind::LF,
                captured_at,
                write_count: 0,
                identity: Some(IdentityFields {
                    customer: identity.customer,
                    data32: identity.data32,
                    facility: identity.facility(),
                    card: identity.card(),
                    // The old store never kept the bytes the Reader reported.
                    raw: String::new(),
                }),
                hf: None,
            },
            raw_only: false,
        };
    }

    // Could not be decoded: preserve the stored read itself rather than drop it.
    // The note is the only free-text field a Snapshot has, and the library page
    // already marks an Identity-less Snapshot as "raw only".
    let payload = Value::Object(object.clone()).to_string();
    let note = if note.trim().is_empty() {
        format!("Preserved as the old version stored it: {payload}")
    } else {
        format!("{note}. Preserved as the old version stored it: {payload}")
    };
    Mapped {
        snapshot: Snapshot {
            id: preserved_id(stored_id, index, library),
            name,
            note,
            kind: Kind::LF,
            captured_at,
            write_count: 0,
            identity: None,
            hf: None,
        },
        raw_only: true,
    }
}

/// The id a preserved read is filed under: the id it was saved under, prefixed
/// so it can never collide with a decoded Identity's id, which rename and delete
/// need to stay unambiguous.
fn preserved_id(stored_id: Option<&str>, index: usize, library: &Library) -> String {
    let candidate = match stored_id {
        Some(text) if !text.trim().is_empty() => format!("legacy-{}", text.trim()),
        _ => format!("legacy-{index}"),
    };
    if library.snapshots.iter().any(|s| s.id == candidate) {
        format!("legacy-{index}")
    } else {
        candidate
    }
}

/// The customer byte as the old store held it. A missing value is `0`, which is
/// what the old loader defaulted to; a value it could never have written is not
/// guessed at.
fn customer_byte(value: Option<&Value>) -> Option<u8> {
    match value {
        None | Some(Value::Null) => Some(0),
        Some(value) => value.as_u64().and_then(|n| u8::try_from(n).ok()),
    }
}

/// The 32-bit data field, when it is one an Identity can be decoded from.
fn data32_field(value: Option<&Value>) -> Option<u32> {
    let data32 = u32::try_from(value?.as_u64()?).ok()?;
    // No data field is not a read; a field wider than facility and card cannot
    // be decoded; a zero field is a blanked Tag, which the codec refuses to name.
    if data32 == 0 || data32 > MAX_DATA32 {
        return None;
    }
    Some(data32)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stored read exactly as the old store wrote it.
    const SAVED_READ: &str = r#"{
        "id": "55 00 84 82 12",
        "customer": 85,
        "data32": 8684050,
        "name": "Front door",
        "savedAt": "2026-11-01T10:00:00.000Z"
    }"#;

    /// The migration time, standing in for a read the oldest store saved without
    /// a timestamp.
    const NOW: &str = "2026-11-21T09:30:00.000Z";

    fn entries(json: &str) -> Vec<Value> {
        serde_json::from_str(json).expect("a fixture in the old store's shape")
    }

    fn temp_store() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        (dir, path)
    }

    #[test]
    fn a_stored_read_arrives_as_a_snapshot_with_every_field_mapped() {
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);

        let run = migrate(&store, &entries(&format!("[{SAVED_READ}]")), NOW).expect("migration");

        assert_eq!(run.status, MigrationStatus::Migrated);
        assert_eq!(run.migrated, 1);
        assert_eq!(run.raw_only, 0);
        assert_eq!(run.already_present, 0);
        assert_eq!(run.unmapped, Vec::<String>::new());

        // The file itself, not just the returned value: this is what the next
        // launch reads.
        let library = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(
            library.snapshots,
            vec![Snapshot {
                id: "55 00 84 82 12".to_string(),
                name: "Front door".to_string(),
                note: String::new(),
                kind: Kind::LF,
                captured_at: "2026-11-01T10:00:00.000Z".to_string(),
                write_count: 0,
                // The old store never kept the payload bytes, so `raw` is empty
                // rather than an id string dressed up as one.
                identity: Some(IdentityFields {
                    customer: 0x55,
                    data32: 0x0084_8212,
                    facility: 132,
                    card: 33298,
                    raw: String::new(),
                }),
                hf: None,
            }]
        );
    }

    #[test]
    fn the_old_shape_that_omitted_name_customer_and_note_still_migrates() {
        // The variants the old loader defaulted: no name, no customer, a note
        // (which only later builds wrote), and a timestamp.
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let stored = r#"[{
            "id": "00 00 53 C7 B3",
            "data32": 5490611,
            "savedAt": "2026-11-02T10:00:00.000Z",
            "note": "spare tag for the back gate"
        }]"#;

        let run = migrate(&store, &entries(stored), NOW).expect("migration");
        assert_eq!(run.migrated, 1);

        let library = LibraryStore::new(&path).load().expect("reload");
        let snapshot = &library.snapshots[0];
        assert_eq!(snapshot.name, "Snapshot 1", "an unnamed read gets a title");
        assert_eq!(snapshot.note, "spare tag for the back gate");
        assert_eq!(snapshot.captured_at, "2026-11-02T10:00:00.000Z");
        let identity = snapshot.identity.as_ref().expect("a decodable identity");
        assert_eq!(identity.customer, 0, "the old loader's default customer");
        assert_eq!(identity.data32, 0x0053_C7B3);
        assert_eq!(identity.facility, 0x53);
        assert_eq!(identity.card, 0xC7B3);
    }

    #[test]
    fn a_stored_read_with_no_timestamp_is_stamped_with_the_migration_time() {
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let stored = r#"[{"id": "55 00 84 82 12", "customer": 85, "data32": 8684050}]"#;

        migrate(&store, &entries(stored), NOW).expect("migration");

        let library = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(library.snapshots[0].captured_at, NOW);
    }

    #[test]
    fn a_stored_id_that_disagrees_with_its_identity_is_reported() {
        // The old loader defaulted a missing customer to 0, so an id written by a
        // build that knew the customer no longer matches what the fields decode
        // to. The Identity wins — it is what a write would reproduce — and the
        // stored id is reported instead of being dropped in silence.
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let stored = r#"[{"id": "56 00 53 C7 B3", "data32": 5490611}]"#;

        let run = migrate(&store, &entries(stored), NOW).expect("migration");

        assert_eq!(run.migrated, 1);
        assert_eq!(run.unmapped, vec!["id".to_string()]);
        let library = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(library.snapshots[0].id, "00 00 53 C7 B3");
    }

    #[test]
    fn a_stored_read_that_cannot_be_decoded_is_preserved_raw_only() {
        // Three ways a stored read cannot become an Identity: no data field, a
        // data field wider than facility and card can hold, and a zero data field
        // (a blanked Tag, which the codec refuses to name).
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let stored = r#"[
            {"id": "57 00 AA BB CC", "customer": 87, "name": "no data field", "savedAt": "2026-11-03T10:00:00.000Z"},
            {"id": "58 00 11 22 33", "customer": 88, "data32": 4294967295, "savedAt": "2026-11-04T10:00:00.000Z"},
            {"id": "59 00 00 00 00", "customer": 89, "data32": 0, "savedAt": "2026-11-05T10:00:00.000Z"}
        ]"#;

        let run = migrate(&store, &entries(stored), NOW).expect("migration");

        assert_eq!(run.migrated, 3);
        assert_eq!(run.raw_only, 3, "none of them could be decoded");

        let library = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(library.snapshots.len(), 3, "nothing was dropped");
        for (snapshot, stored_id) in
            library
                .snapshots
                .iter()
                .zip(["57 00 AA BB CC", "58 00 11 22 33", "59 00 00 00 00"])
        {
            assert_eq!(snapshot.identity, None, "no Identity is invented");
            assert_eq!(snapshot.hf, None, "nothing pretends to be a UID");
            assert_eq!(snapshot.kind, Kind::LF);
            assert!(
                snapshot.id.contains(stored_id),
                "the preserved read keeps the id it was saved under: {}",
                snapshot.id
            );
            assert!(
                snapshot.note.contains(stored_id) && snapshot.note.contains("\"customer\""),
                "the payload itself is preserved in the note: {}",
                snapshot.note
            );
        }
        // Unnamed reads still get a title, so the list never shows a blank row.
        assert_eq!(library.snapshots[0].name, "no data field");
        assert_eq!(library.snapshots[1].name, "Snapshot 1");
        assert_eq!(library.snapshots[2].name, "Snapshot 2");
    }

    #[test]
    fn a_preserved_read_never_collides_with_a_decoded_snapshot_id() {
        // A messy store can hold the same id twice, once decodable and once not.
        // Ids identify a Snapshot for rename and delete, so they must be unique.
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let stored = r#"[
            {"id": "55 00 84 82 12", "customer": 85, "data32": 8684050, "name": "Front door"},
            {"id": "55 00 84 82 12", "customer": 85, "name": "no data field"}
        ]"#;

        let run = migrate(&store, &entries(stored), NOW).expect("migration");
        assert_eq!(run.migrated, 2);

        let library = LibraryStore::new(&path).load().expect("reload");
        let mut ids: Vec<&str> = library.snapshots.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids.len(), 2);
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 2, "two Snapshots, two distinguishable ids");
    }

    #[test]
    fn an_unknown_key_in_the_old_store_is_reported_rather_than_dropped() {
        // Anything the old store recorded that a Snapshot has no home for has to
        // be visible, so nobody has to guess what was lost.
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let stored = r#"[{
            "id": "55 00 84 82 12",
            "customer": 85,
            "data32": 8684050,
            "facility": 132,
            "tags": ["door", "gate"]
        }]"#;

        let run = migrate(&store, &entries(stored), NOW).expect("migration");

        assert_eq!(
            run.unmapped,
            vec!["facility".to_string(), "tags".to_string()]
        );
    }

    #[test]
    fn what_the_old_store_never_recorded_is_reported_not_invented() {
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let run = migrate(&store, &entries(&format!("[{SAVED_READ}]")), NOW).expect("migration");

        assert_eq!(run.missing, MISSING_FIELDS.to_vec());
        let library = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(library.snapshots[0].write_count, 0);
        assert_eq!(
            library.snapshots[0]
                .identity
                .as_ref()
                .map(|i| i.raw.as_str()),
            Some(""),
            "no payload bytes are fabricated"
        );
    }

    #[test]
    fn migration_does_not_run_when_the_library_file_already_exists() {
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let mut existing = Library::empty();
        existing.add_lf(0x56, 0x0053_C7B3, "00 01 01", "2026-11-20T08:00:00.000Z");
        store
            .save(&existing)
            .expect("a library the user already has");
        let bytes = std::fs::read(&path).expect("read the library");

        let run = migrate(&store, &entries(&format!("[{SAVED_READ}]")), NOW).expect("migration");

        assert_eq!(run.status, MigrationStatus::LibraryExists);
        assert_eq!(run.migrated, 0);
        assert_eq!(
            std::fs::read(&path).expect("read the library"),
            bytes,
            "an existing library is left byte for byte"
        );
        assert_eq!(
            LibraryStore::new(&path).load().expect("reload").snapshots,
            existing.snapshots
        );
    }

    #[test]
    fn a_second_launch_does_not_duplicate_the_migrated_snapshots() {
        let (_dir, path) = temp_store();
        let stored = entries(&format!("[{SAVED_READ}]"));

        migrate(&LibraryStore::new(&path), &stored, NOW).expect("first launch");
        // A fresh handle, as the next launch of the app would use.
        let second = migrate(&LibraryStore::new(&path), &stored, NOW).expect("second launch");

        assert_eq!(second.status, MigrationStatus::LibraryExists);
        assert_eq!(second.migrated, 0);
        assert_eq!(
            LibraryStore::new(&path)
                .load()
                .expect("reload")
                .snapshots
                .len(),
            1
        );
    }

    #[test]
    fn the_same_stored_read_twice_in_the_old_store_is_added_once() {
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);
        let stored = r#"[
            {"id": "55 00 84 82 12", "customer": 85, "data32": 8684050, "name": "Front door"},
            {"id": "55 00 84 82 12", "customer": 85, "data32": 8684050, "name": "Front door again"}
        ]"#;

        let run = migrate(&store, &entries(stored), NOW).expect("migration");

        assert_eq!(run.migrated, 1);
        assert_eq!(run.already_present, 1);
        let library = LibraryStore::new(&path).load().expect("reload");
        assert_eq!(library.snapshots.len(), 1);
        assert_eq!(
            library.snapshots[0].name, "Front door",
            "the first read wins"
        );
    }

    #[test]
    fn nothing_to_migrate_creates_no_library_file() {
        // Creating an empty library would end migration for good: the file would
        // exist and every later launch would skip. Nothing stored means nothing
        // written.
        let (_dir, path) = temp_store();
        let store = LibraryStore::new(&path);

        let run = migrate(&store, &[], NOW).expect("migration");
        assert_eq!(run.status, MigrationStatus::NothingToMigrate);
        assert_eq!(run.migrated, 0);
        assert!(!path.exists(), "an empty library is not created");

        // Array elements that are not stored reads at all are counted, not
        // preserved, and still nothing is written.
        let run = migrate(&store, &entries(r#"[null, "not a read", 42]"#), NOW).expect("migration");
        assert_eq!(run.status, MigrationStatus::NothingToMigrate);
        assert_eq!(run.skipped, 3);
        assert!(!path.exists());
    }

    #[test]
    fn a_failed_write_leaves_no_library_file_so_the_next_launch_migrates_once() {
        // The failure case the idempotence rule has to survive: the app dies, or
        // the write fails, before the file is committed. Nothing is half-written,
        // so the next launch migrates from scratch and still ends with one copy
        // of each read.
        let dir = tempfile::tempdir().expect("temp dir");
        let blocked = dir.path().join("not-a-directory");
        std::fs::write(&blocked, b"a file where a directory has to be").expect("blocker");
        let path = blocked.join("library.json");
        let store = LibraryStore::new(&path);
        let stored = entries(&format!("[{SAVED_READ}]"));

        assert!(
            migrate(&store, &stored, NOW).is_err(),
            "a write that cannot succeed must report failure"
        );

        std::fs::remove_file(&blocked).expect("clear the blocker");
        migrate(&LibraryStore::new(&path), &stored, NOW).expect("the next launch migrates");
        let retried = migrate(&LibraryStore::new(&path), &stored, NOW).expect("and runs once");

        assert_eq!(retried.status, MigrationStatus::LibraryExists);
        assert_eq!(
            LibraryStore::new(&path)
                .load()
                .expect("reload")
                .snapshots
                .len(),
            1,
            "one copy of the read, however many launches ran"
        );
    }

    #[test]
    fn a_library_file_that_cannot_be_read_is_never_migrated_into_or_replaced() {
        let (_dir, path) = temp_store();
        let torn = b"{\"version\":1,\"snapshots\":[{\"id\":\"55 00".to_vec();
        std::fs::write(&path, &torn).expect("write a torn file");

        let refused = migrate(
            &LibraryStore::new(&path),
            &entries(&format!("[{SAVED_READ}]")),
            NOW,
        )
        .expect_err("a file this build cannot read must not be touched");
        assert!(matches!(refused, MigrationError::Refused(_)), "{refused:?}");
        assert_eq!(
            std::fs::read(&path).expect("read the file"),
            torn,
            "the unreadable file is left exactly as it was"
        );
    }

    #[test]
    fn a_library_file_from_a_newer_schema_is_not_migrated_into() {
        let (_dir, path) = temp_store();
        let newer = br#"{"version": 99, "snapshots": []}"#.to_vec();
        std::fs::write(&path, &newer).expect("write a newer file");

        let refused = migrate(
            &LibraryStore::new(&path),
            &entries(&format!("[{SAVED_READ}]")),
            NOW,
        )
        .expect_err("a newer file must not be touched");
        assert!(matches!(refused, MigrationError::Refused(_)), "{refused:?}");
        assert_eq!(std::fs::read(&path).expect("read the file"), newer);
    }
}
