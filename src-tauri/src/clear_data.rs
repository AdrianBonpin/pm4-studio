//! Clearing every file this app has saved on this machine.
//!
//! One action, two file targets, and no way to name a third. The scope is
//! resolved from the app data directory this build resolves for itself — the
//! library file and the `.tmp` sibling a save stages beside it — so there is no
//! path parameter to pass and nothing outside the app's own storage to reach.
//! [`ClearScope::resolve`] is the only constructor outside these tests, and it
//! takes a directory rather than paths: the names are fixed here.
//!
//! No target is ever followed. A target that is a symbolic link is refused
//! rather than read through, so an entry inside this app's storage cannot stand
//! in for a file outside it; and the containment check refuses any path that is
//! not the resolved name inside the resolved directory.
//!
//! Nothing is removed until every target that exists has been checked. A target
//! this app did not write (a directory, a link, something whose details cannot
//! be read) or a read-only directory refuses the whole action before the first
//! delete, naming the part that blocked it and leaving every other target in
//! place. That is the difference between "clear" and "clear as much as it
//! can": the user is never left with half of their saved data gone and no way
//! to tell which half.
//!
//! The webview's own storage — the legacy saved-reads store and the preference
//! keys — is not reachable from this process, so the webview half of the same
//! action, `src/lib/clearData.ts`, removes those and joins them to this report.
//! The two halves are one action in the interface, but only this half touches the
//! filesystem.
//!
//! Why deleting here is not a second write path
//! ---------------------------------------------
//! The library's rule is that a file this build cannot read is reported and
//! never overwritten, because a clean start on top of unreadable bytes is data
//! loss (see the module docs in [`crate::library`], where the rule lives). This
//! module is the one **documented exception** to it, and the exception is
//! narrow: it deletes files only when a user asks for exactly that, through the
//! Settings → Data gate that requires the word `clear` to be typed, and it
//! never writes. No save, import, migration or load calls it — a failed save or
//! an unreadable file still refuses and leaves the bytes exactly as they are —
//! so "clear" can never become the fallback that quietly destroys the file a
//! refusal was protecting.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::atomic_file::staging_path;
use crate::library::{Domain, FILE_NAME};

/// One file the clear action is allowed to remove.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    /// The library itself.
    LibraryFile,
    /// The sibling a save stages before renaming it into place.
    StaleTemp,
}

impl TargetKind {
    /// The id the webview reports. Stable, because it is part of the report.
    pub fn id(self) -> &'static str {
        match self {
            TargetKind::LibraryFile => "libraryFile",
            TargetKind::StaleTemp => "staleTemp",
        }
    }

    /// Which part of this app's storage the target is, in the user's words.
    pub fn label(self) -> &'static str {
        match self {
            TargetKind::LibraryFile => "the library file",
            TargetKind::StaleTemp => "the temporary file left beside it",
        }
    }
}

/// One resolved target: a kind and the path it was resolved to.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub kind: TargetKind,
    pub path: PathBuf,
}

/// The files one clear action may remove, resolved from a directory.
#[derive(Debug, Clone, PartialEq)]
pub struct ClearScope {
    dir: PathBuf,
    targets: Vec<Target>,
}

/// One file that was removed.
#[derive(Debug, Clone, PartialEq)]
pub struct Removed {
    pub kind: TargetKind,
    pub path: PathBuf,
    pub bytes: u64,
}

/// One file that stopped the action, and why.
#[derive(Debug, Clone, PartialEq)]
pub struct Blocked {
    pub kind: TargetKind,
    pub path: PathBuf,
    pub reason: String,
}

/// What clearing came to.
#[derive(Debug, Clone, PartialEq)]
pub enum ClearOutcome {
    /// Every target that existed was removed. `removed` is exactly those.
    Cleared { removed: Vec<Removed> },
    /// Nothing was removed, and `blocked` names the part that stopped it.
    Refused {
        blocked: Blocked,
        /// What had already been removed when the refusal happened. Empty
        /// whenever the refusal came from the check before any removal.
        removed: Vec<Removed>,
    },
}

impl ClearScope {
    /// Resolve this app's files inside one app data directory.
    ///
    /// This is the only way to build a scope outside a test, and it takes a
    /// directory rather than file paths: the two file names are fixed here, so
    /// there is no argument through which a caller could name another file.
    pub fn resolve(dir: &Path) -> Self {
        let library = dir.join(FILE_NAME);
        Self {
            dir: dir.to_path_buf(),
            targets: vec![
                Target {
                    kind: TargetKind::LibraryFile,
                    path: library.clone(),
                },
                Target {
                    kind: TargetKind::StaleTemp,
                    path: staging_path(&library),
                },
            ],
        }
    }

    /// Every file the action is allowed to consider, existing or not.
    pub fn targets(&self) -> &[Target] {
        &self.targets
    }

    /// A scope built from paths a caller chose, for the tests that prove the
    /// containment check refuses one. Never available to a caller of the crate.
    #[cfg(test)]
    fn with_targets(dir: &Path, targets: Vec<Target>) -> Self {
        Self {
            dir: dir.to_path_buf(),
            targets,
        }
    }
}

/// Remove every file in `scope` that currently exists, and report exactly that.
///
/// Nothing is removed until every existing target has passed the checks in
/// [`preflight`], so a target that cannot be removed refuses the whole action
/// before the first delete: "clear" either clears, or leaves everything as it
/// was and names the part that stopped it. The one case that can still remove
/// something and then fail is a change on disk between the check and the delete
/// (a race with something outside this app); it is reported for what it is,
/// with the part that could not be removed and the parts that went.
///
/// `_domain` is the library's serialisation domain. The library file is deleted
/// under it, so a save in flight cannot rename a fresh library over the file
/// this action just removed.
pub fn clear(_domain: &Domain, scope: &ClearScope) -> ClearOutcome {
    let mut present: Vec<(Target, u64)> = Vec::new();
    for target in scope.targets() {
        match preflight(scope, target) {
            Ok(Some(bytes)) => present.push((target.clone(), bytes)),
            Ok(None) => {}
            Err(reason) => {
                return ClearOutcome::Refused {
                    blocked: Blocked {
                        kind: target.kind,
                        path: target.path.clone(),
                        reason,
                    },
                    // A refusal is decided before anything is removed.
                    removed: Vec::new(),
                }
            }
        }
    }

    let mut removed = Vec::new();
    for (target, bytes) in present {
        match fs::remove_file(&target.path) {
            Ok(()) => removed.push(Removed {
                kind: target.kind,
                path: target.path,
                bytes,
            }),
            Err(e) => {
                return ClearOutcome::Refused {
                    blocked: Blocked {
                        kind: target.kind,
                        path: target.path,
                        reason: format!("it could not be removed: {e}"),
                    },
                    removed,
                }
            }
        }
    }
    ClearOutcome::Cleared { removed }
}

/// Check one target before anything is removed.
///
/// `Ok(None)` means there is nothing there, which is not a failure: a library
/// nobody has written has no file, and clearing it reports nothing removed.
/// `Ok(Some(bytes))` is a file that may be removed. `Err` is the refusal that
/// stops the whole action, worded for the report.
///
/// Every question is asked of [`fs::symlink_metadata`], never of
/// [`fs::metadata`]: the second follows a link, and following one would answer
/// for a file outside this app's storage while the delete removed the entry in
/// here. A symlink is refused rather than removed, so the action cannot be aimed
/// at another file at all.
fn preflight(scope: &ClearScope, target: &Target) -> Result<Option<u64>, String> {
    // The scope resolved these paths from fixed names; a path anywhere else can
    // only arrive through a constructor this crate does not offer, and is
    // refused rather than acted on.
    if target.path.parent() != Some(scope.dir.as_path()) {
        return Err(format!(
            "it resolves outside the app data directory ({})",
            scope.dir.display()
        ));
    }
    let meta = match fs::symlink_metadata(&target.path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("its details could not be read: {e}")),
    };
    if meta.file_type().is_symlink() {
        return Err(
            "it is a symbolic link, and this action never follows one".to_string(),
        );
    }
    if !meta.is_file() {
        return Err(format!(
            "it is not a regular file ({}), so it is not something this app wrote",
            describe_kind(&meta)
        ));
    }
    match fs::metadata(&scope.dir) {
        Ok(dir) if dir.permissions().readonly() => {
            return Err("the directory holding it is read-only".to_string())
        }
        Ok(_) => {}
        Err(e) => return Err(format!("the app data directory could not be read: {e}")),
    }
    Ok(Some(meta.len()))
}

/// What a directory entry is, for the refusal that found it.
fn describe_kind(meta: &fs::Metadata) -> &'static str {
    if meta.is_dir() {
        "a directory"
    } else if meta.file_type().is_symlink() {
        "a symbolic link"
    } else {
        "not a file"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::serialised;

    /// The clear action as the command runs it: inside the library's domain.
    fn run(scope: &ClearScope) -> ClearOutcome {
        serialised(|domain| clear(domain, scope))
    }

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp dir")
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .expect("read dir")
            .map(|entry| entry.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn removed_ids(outcome: &ClearOutcome) -> Vec<&'static str> {
        match outcome {
            ClearOutcome::Cleared { removed } => removed.iter().map(|r| r.kind.id()).collect(),
            ClearOutcome::Refused { .. } => panic!("expected a clear, got {outcome:?}"),
        }
    }

    #[test]
    fn it_removes_the_library_file_and_the_stale_sibling_and_reports_both() {
        let dir = temp_dir();
        let scope = ClearScope::resolve(dir.path());
        // The two files a save leaves behind: the library, and the sibling a
        // crash left staged beside it.
        fs::write(dir.path().join(FILE_NAME), b"{\"version\":2}").expect("library");
        fs::write(
            dir.path().join(format!("{FILE_NAME}.tmp")),
            b"{\"version\":2,\"snapsh",
        )
        .expect("stale staging file");

        let outcome = run(&scope);

        // Exactly the two files, named, with the sizes that were removed.
        assert_eq!(removed_ids(&outcome), vec!["libraryFile", "staleTemp"]);
        match &outcome {
            ClearOutcome::Cleared { removed } => {
                assert_eq!(removed[0].path, dir.path().join(FILE_NAME));
                assert_eq!(removed[0].bytes, 13);
                assert_eq!(removed[1].path, dir.path().join(format!("{FILE_NAME}.tmp")));
            }
            ClearOutcome::Refused { .. } => unreachable!(),
        }
        assert_eq!(names(dir.path()), Vec::<String>::new());
    }

    #[test]
    fn a_target_that_is_not_there_is_not_reported_as_removed() {
        let dir = temp_dir();
        let scope = ClearScope::resolve(dir.path());
        fs::write(dir.path().join(FILE_NAME), b"{}").expect("library");

        let outcome = run(&scope);

        // Only what existed and went. Claiming to have removed a file that was
        // never there is the report lying about the action.
        assert_eq!(removed_ids(&outcome), vec!["libraryFile"]);
        assert_eq!(names(dir.path()), Vec::<String>::new());
    }

    #[test]
    fn nothing_saved_clears_to_nothing_and_claims_nothing() {
        let dir = temp_dir();
        let scope = ClearScope::resolve(dir.path());

        assert_eq!(
            run(&scope),
            ClearOutcome::Cleared { removed: Vec::new() },
            "an empty app data directory is a clear with nothing to report"
        );
    }

    #[test]
    fn an_unrelated_file_in_the_directory_is_untouched() {
        let dir = temp_dir();
        let scope = ClearScope::resolve(dir.path());
        fs::write(dir.path().join(FILE_NAME), b"{}").expect("library");
        fs::write(dir.path().join("notes.txt"), b"not mine").expect("a file we never wrote");

        run(&scope);

        assert_eq!(names(dir.path()), vec!["notes.txt"]);
        assert_eq!(
            fs::read(dir.path().join("notes.txt")).expect("read"),
            b"not mine"
        );
    }

    #[test]
    fn a_target_that_is_a_directory_refuses_the_whole_action() {
        let dir = temp_dir();
        let scope = ClearScope::resolve(dir.path());
        fs::write(dir.path().join(FILE_NAME), b"{}").expect("library");
        // Something that is not the staging file, at the staging file's path.
        fs::create_dir(dir.path().join(format!("{FILE_NAME}.tmp"))).expect("a directory");

        let outcome = run(&scope);

        match &outcome {
            ClearOutcome::Refused { blocked, removed } => {
                assert_eq!(blocked.kind, TargetKind::StaleTemp);
                assert!(
                    blocked.reason.contains("not a regular file"),
                    "the refusal names what it found: {:?}",
                    blocked.reason
                );
                assert!(
                    removed.is_empty(),
                    "a refusal removes nothing at all: {removed:?}"
                );
            }
            ClearOutcome::Cleared { .. } => panic!("expected a refusal"),
        }
        // The library is still exactly where it was: refusing is not a partial
        // clear.
        assert_eq!(
            fs::read(dir.path().join(FILE_NAME)).expect("the library survives"),
            b"{}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_target_is_refused_and_the_file_it_points_at_survives() {
        let dir = temp_dir();
        let outside = temp_dir();
        let scope = ClearScope::resolve(dir.path());
        let precious = outside.path().join("somewhere-else.json");
        fs::write(&precious, b"a file outside this app's storage").expect("outside file");
        std::os::unix::fs::symlink(&precious, dir.path().join(FILE_NAME)).expect("symlink");

        let outcome = run(&scope);

        match &outcome {
            ClearOutcome::Refused { blocked, removed } => {
                assert_eq!(blocked.kind, TargetKind::LibraryFile);
                assert!(
                    blocked.reason.contains("symbolic link"),
                    "the refusal says why: {:?}",
                    blocked.reason
                );
                assert!(removed.is_empty());
            }
            ClearOutcome::Cleared { .. } => panic!("a symlink is never followed"),
        }
        // The link is still there, and the file it points at is untouched.
        assert!(dir.path().join(FILE_NAME).exists());
        assert_eq!(
            fs::read(&precious).expect("the target file survives"),
            b"a file outside this app's storage"
        );
    }

    #[test]
    fn a_scope_aimed_outside_the_app_data_directory_is_refused() {
        // The only constructor a caller has resolves both paths from fixed
        // names. This scope stands in for one built some other way, and proves
        // the check inside `clear` refuses it rather than trusting the type.
        let dir = temp_dir();
        let outside = temp_dir();
        let precious = outside.path().join("precious.json");
        fs::write(&precious, b"somebody else's file").expect("outside file");
        let scope = ClearScope::with_targets(
            dir.path(),
            vec![Target {
                kind: TargetKind::LibraryFile,
                path: precious.clone(),
            }],
        );

        let outcome = run(&scope);

        match &outcome {
            ClearOutcome::Refused { blocked, removed } => {
                assert_eq!(blocked.kind, TargetKind::LibraryFile);
                assert!(
                    blocked.reason.contains("outside the app data directory"),
                    "the refusal names the reason: {:?}",
                    blocked.reason
                );
                assert!(removed.is_empty());
            }
            ClearOutcome::Cleared { .. } => panic!("a target outside the app's storage is refused"),
        }
        assert_eq!(
            fs::read(&precious).expect("the outside file survives"),
            b"somebody else's file"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_directory_refuses_before_anything_is_removed() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir();
        let scope = ClearScope::resolve(dir.path());
        fs::write(dir.path().join(FILE_NAME), b"{}").expect("library");
        fs::write(dir.path().join(format!("{FILE_NAME}.tmp")), b"{}").expect("stale");

        let original = fs::metadata(dir.path()).expect("metadata").permissions();
        let mut readonly = original.clone();
        readonly.set_mode(0o555);
        fs::set_permissions(dir.path(), readonly).expect("make the directory read-only");
        // A privileged test runner can still write here, and then the check
        // this test is about is not the one deciding. Nothing to prove there.
        let writable = fs::write(dir.path().join("probe"), b"x").is_ok();
        if writable {
            let _ = fs::remove_file(dir.path().join("probe"));
            fs::set_permissions(dir.path(), original).expect("restore");
            return;
        }

        let outcome = run(&scope);

        // Restore before asserting, so a failing assertion cannot leave a temp
        // directory that cannot be cleaned up.
        fs::set_permissions(dir.path(), original).expect("restore");

        match &outcome {
            ClearOutcome::Refused { blocked, removed } => {
                assert_eq!(blocked.kind, TargetKind::LibraryFile);
                assert!(
                    blocked.reason.contains("read-only"),
                    "the refusal names the reason: {:?}",
                    blocked.reason
                );
                assert!(removed.is_empty());
            }
            ClearOutcome::Cleared { .. } => panic!("a read-only directory cannot be cleared"),
        }
        assert!(dir.path().join(FILE_NAME).exists());
        assert!(dir.path().join(format!("{FILE_NAME}.tmp")).exists());
    }

    #[test]
    fn the_scope_resolves_the_two_known_siblings_and_nothing_else() {
        let dir = temp_dir();

        let scope = ClearScope::resolve(dir.path());

        assert_eq!(
            scope.targets(),
            &[
                Target {
                    kind: TargetKind::LibraryFile,
                    path: dir.path().join(FILE_NAME),
                },
                Target {
                    kind: TargetKind::StaleTemp,
                    path: dir.path().join(format!("{FILE_NAME}.tmp")),
                },
            ],
            "both targets are fixed names under the directory the app resolved"
        );
    }
}
