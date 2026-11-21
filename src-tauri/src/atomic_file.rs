//! Replacing a file the user chose without ever leaving a torn one.
//!
//! Two steps, and nothing here knows what the file is: stage the bytes beside the
//! target and flush them to the platter, then rename the staging file over the
//! target in one step and flush the directory entry that now points at it. A
//! crash at any point leaves the previous file or the new one, never half of
//! either.
//!
//! Why there is no "write this path atomically" function here
//! -----------------------------------------------------------
//! A helper that took a `&Path` and a `&[u8]` would be the whole act of writing a
//! file behind one call, and it would have to be callable by every module that
//! writes one. The library file is written by that same act, but it is *not* a
//! file the user chose: a library write has to happen inside the serialisation
//! domain, and ticket 03's guarantee is that a library write cannot be reached
//! without the [`Domain`] token (`library::write_atomically`).
//!
//! So the composition is deliberately absent from the crate's visible surface and
//! the two steps are composed at the two places that write a whole file:
//!
//! * `library::write_atomically` — the library file, which demands the token.
//! * `library_io::write_text` — one file the user picked, such as a memory dump,
//!   which shares no starting state with the library and does not queue behind a
//!   save.
//!
//! A module that stages and commits a file is therefore saying, in code, that it
//! is writing a whole file, and review can see which file it is. What that leaves
//! to convention is written down at `library::write_atomically`: nothing in the
//! type checker stops a caller from composing these two steps on the library's
//! own path.
//!
//! [`Domain`]: crate::library::Domain

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Suffix of the staging file a write stages before renaming it into place.
///
/// One suffix for every write, because there is one writer at a time: the
/// library's serialisation domain is what stops two *library* writes staging into
/// the same path, and a file the user chose is written by the one operation that
/// was asked for. A stale staging file is never read back — it is overwritten by
/// the next stage of the same path, or left behind by a crash before the rename.
pub(crate) const TEMP_SUFFIX: &str = ".tmp";

/// Stage `bytes` beside `path` and flush them, creating the directory if the
/// write is the first thing to happen there.
///
/// The target is untouched when this returns: what the user has is still the
/// previous file, whatever happens next.
pub(crate) fn stage_bytes(path: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
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
pub(crate) fn commit_staged(staged: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(staged, path)?;
    if let Some(parent) = path.parent() {
        // Flush the directory entry so the rename itself is durable.
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// Where the bytes for `path` are staged: a sibling, so the rename that commits
/// them never crosses a filesystem boundary.
pub(crate) fn staging_path(path: &Path) -> PathBuf {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_staged_write_leaves_the_target_alone_until_it_is_committed() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("dump.txt");
        fs::write(&path, b"what was there before").expect("write the previous file");

        let staged = stage_bytes(&path, b"the new bytes").expect("stage");
        assert_eq!(staged, staging_path(&path), "the staging file is a sibling");
        assert_eq!(
            fs::read(&path).expect("read the target"),
            b"what was there before",
            "staging does not touch the file the user has"
        );
        assert_eq!(fs::read(&staged).expect("read the staging file"), b"the new bytes");

        commit_staged(&staged, &path).expect("commit");
        assert_eq!(fs::read(&path).expect("read the target"), b"the new bytes");
        assert!(!staged.exists(), "the staging file is gone once it is renamed");
    }

    #[test]
    fn staging_creates_the_directory_it_writes_into() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("a").join("b").join("dump.txt");

        let staged = stage_bytes(&path, b"bytes").expect("stage into a new directory");
        assert_eq!(fs::read(&staged).expect("read the staging file"), b"bytes");

        commit_staged(&staged, &path).expect("commit");
        assert_eq!(fs::read(&path).expect("read the target"), b"bytes");
    }
}
