//! Lifting a library file written by an older build up to this build's schema.
//!
//! ADR 0005: a new persisted key is a schema change, and a schema change bumps
//! the version. This module is the half of that rule the newer build owes the
//! older one.
//!
//! - **Forwards** (this build reads an older file): the file is lifted, version
//!   by version, until it is this build's schema.
//! - **Backwards** (an older build reads this file): nothing here can help. The
//!   older build refuses the file because the version says so — which is the
//!   whole point of the bump, and why lifting must happen eagerly at open
//!   rather than at the next save.
//!
//! A step works on the document itself — the parsed JSON object — not on
//! [`Library`](crate::library::Library). A collection this build does not model
//! is therefore carried through untouched, because a migration that silently
//! drops a collection is the defect this module exists to prevent, and reading
//! into the struct first would recreate it at the one moment it matters most.
//!
//! One version at a time, so a build that carries two steps reads a file two
//! versions behind by walking it up twice. The oldest version this build can
//! walk up from is [`OLDEST_MIGRATABLE`]; a file older than that is reported as
//! old rather than guessed at, because a lift nobody wrote is a guess.

use serde_json::Value;

use crate::library::{LibraryProblem, SCHEMA_VERSION};

/// The oldest schema this build can lift to its own.
///
/// A file below this is refused as [`LibraryProblem::OlderVersion`], not read
/// as the oldest shape this build knows: the difference between "old" and
/// "damaged" is the difference between a message the user can act on and one
/// that tells them their data is broken when it is merely old.
pub const OLDEST_MIGRATABLE: u32 = 1;

/// Lift `document`, written at `found`, up to this build's schema.
///
/// One version at a time, so a build carrying several steps walks a file up
/// them in order rather than needing a step for every pair of versions. Nothing
/// is written here: the caller decides when the lifted document reaches the
/// file, and only the store may write it.
pub fn lift_to_current(document: Value, found: u32) -> Result<Value, LibraryProblem> {
    if found > SCHEMA_VERSION {
        return Err(LibraryProblem::NewerVersion {
            found: u64::from(found),
            supported: SCHEMA_VERSION,
        });
    }
    if found < OLDEST_MIGRATABLE {
        return Err(LibraryProblem::OlderVersion {
            found: u64::from(found),
            supported: SCHEMA_VERSION,
        });
    }

    let mut document = document;
    let mut version = found;
    while version < SCHEMA_VERSION {
        document = one_version_up(document, version)?;
        version += 1;
    }
    Ok(document)
}

/// One step: the document as it is written at `from`, as it is written at
/// `from + 1`.
fn one_version_up(document: Value, from: u32) -> Result<Value, LibraryProblem> {
    match from {
        1 => v1_to_v2(document),
        // Unreachable through `lift_to_current`, which walks the versions this
        // build carries and refuses anything older than the first. Kept explicit
        // so a new step cannot be forgotten silently: an unimplemented version
        // is reported, never written as if it had been lifted.
        other => Err(LibraryProblem::Corrupt {
            detail: format!("no migration is written from schema {other}"),
        }),
    }
}

/// Schema 1 → 2: the file states the version its contents already have.
///
/// `drafts` arrived in the library file while the version stayed at 1, so a v1
/// file may or may not carry it, and both are v1 files. A file without it gains
/// an empty list — which is what the store writes for a library with no Drafts,
/// and what an absent collection already meant. A file with it keeps its Drafts
/// exactly, in order.
///
/// Everything else in the object is carried over untouched, including keys this
/// build does not model: the lift is a change of version claim, not a rebuild.
fn v1_to_v2(document: Value) -> Result<Value, LibraryProblem> {
    let Value::Object(mut object) = document else {
        return Err(LibraryProblem::Corrupt {
            detail: "the file is not a JSON object".to_string(),
        });
    };
    object
        .entry("drafts")
        .or_insert_with(|| Value::Array(Vec::new()));
    object.insert("version".to_string(), Value::from(2u32));
    Ok(Value::Object(object))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A library file exactly as a version 1 build wrote it, with the two
    /// Snapshot shapes and two Drafts deliberately out of id order so that a
    /// migration that sorts, or one that rebuilds the collection, shows itself.
    fn v1_document() -> Value {
        json!({
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
                        { "kind": "text", "fields": { "text": "Hello", "language": "en" } }
                    ]
                },
                {
                    "id": "draft-1",
                    "name": "Roof",
                    "updatedAt": "2026-11-21T12:00:00.000Z",
                    "records": []
                }
            ]
        })
    }

    fn names(collection: &Value, key: &str) -> Vec<String> {
        collection
            .as_array()
            .expect("a collection")
            .iter()
            .map(|entry| entry[key].as_str().expect("a name").to_string())
            .collect()
    }

    #[test]
    fn a_v1_document_is_lifted_to_v2_with_each_collection_in_its_own_order() {
        let lifted = lift_to_current(v1_document(), 1).expect("a v1 document lifts");

        assert_eq!(
            lifted["version"],
            json!(2),
            "the lift states the version it produces"
        );
        assert_eq!(
            names(&lifted["snapshots"], "name"),
            vec!["Front door".to_string(), "Back gate".to_string()],
            "the Snapshots are kept, in the order the file held them"
        );
        assert_eq!(
            names(&lifted["drafts"], "id"),
            vec!["draft-2".to_string(), "draft-1".to_string()],
            "the Drafts are kept, in the order the file held them — not sorted"
        );
        assert_eq!(
            lifted["snapshots"][0],
            v1_document()["snapshots"][0],
            "a Snapshot is carried over whole, not rebuilt from the fields this build models"
        );
        assert_eq!(lifted["drafts"][0], v1_document()["drafts"][0]);
    }

    #[test]
    fn a_v1_document_written_before_drafts_existed_gains_an_empty_list() {
        let lifted = lift_to_current(json!({"version": 1, "snapshots": []}), 1)
            .expect("a v1 document without drafts is still a v1 document");

        assert_eq!(
            lifted["drafts"],
            json!([]),
            "an absent collection and an empty one mean the same thing, and v2 says so"
        );
    }

    #[test]
    fn a_v1_document_that_already_carries_drafts_keeps_them() {
        // Drafts were written into version 1 files, which is the defect: the
        // version stayed put while the file grew a key. Both shapes are v1.
        let lifted = lift_to_current(
            json!({"version": 1, "snapshots": [], "drafts": [{"id": "draft-1"}]}),
            1,
        )
        .expect("lifts");

        assert_eq!(lifted["drafts"], json!([{"id": "draft-1"}]));
    }

    #[test]
    fn a_key_this_build_does_not_model_is_carried_through_the_lift() {
        let lifted = lift_to_current(
            json!({
                "version": 1,
                "snapshots": [],
                "tags": ["door", "gate"],
                "futureCollection": [{"kept": true}]
            }),
            1,
        )
        .expect("lifts");

        assert_eq!(lifted["tags"], json!(["door", "gate"]));
        assert_eq!(lifted["futureCollection"], json!([{"kept": true}]));
    }

    #[test]
    fn a_document_above_this_builds_version_is_never_lifted() {
        assert_eq!(
            lift_to_current(json!({"version": 3, "snapshots": []}), 3),
            Err(LibraryProblem::NewerVersion {
                found: 3,
                supported: SCHEMA_VERSION
            }),
        );
    }

    #[test]
    fn a_document_below_the_oldest_migration_is_reported_old_rather_than_guessed_at() {
        assert_eq!(
            lift_to_current(json!({"version": 0, "snapshots": []}), 0),
            Err(LibraryProblem::OlderVersion {
                found: 0,
                supported: SCHEMA_VERSION
            }),
        );
    }

    #[test]
    fn a_document_that_is_not_an_object_is_reported_rather_than_lifted() {
        assert!(matches!(
            lift_to_current(json!(["not", "a", "library"]), 1),
            Err(LibraryProblem::Corrupt { .. })
        ));
    }
}
