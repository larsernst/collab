use std::path::{Component, Path, PathBuf};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PathError {
    #[error("Path escapes the vault root")]
    EscapesRoot,
    #[error("Path must be relative to the vault root")]
    MustBeRelative,
}

pub fn normalize_relative_path(relative_path: &str) -> Result<PathBuf, PathError> {
    let mut out = PathBuf::new();

    for component in Path::new(relative_path).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return Err(PathError::EscapesRoot);
                }
            }
            Component::RootDir | Component::Prefix(_) => return Err(PathError::MustBeRelative),
        }
    }

    Ok(out)
}

pub fn resolve_relative_path(root: &Path, relative_path: &str) -> Result<PathBuf, PathError> {
    Ok(root.join(normalize_relative_path(relative_path)?))
}

#[cfg(test)]
mod tests {
    use super::{normalize_relative_path, resolve_relative_path, PathError};
    use std::path::{Path, PathBuf};

    #[test]
    fn normalizes_safe_relative_paths() {
        assert_eq!(
            normalize_relative_path("Notes/../Notes/Test.md").unwrap(),
            PathBuf::from("Notes/Test.md")
        );
        assert_eq!(
            normalize_relative_path("./Board.kanban").unwrap(),
            PathBuf::from("Board.kanban")
        );
    }

    #[test]
    fn rejects_paths_that_escape_or_are_absolute() {
        assert_eq!(
            normalize_relative_path("../../outside").unwrap_err(),
            PathError::EscapesRoot
        );
        assert_eq!(
            normalize_relative_path("/absolute").unwrap_err(),
            PathError::MustBeRelative
        );
    }

    #[test]
    fn resolves_only_beneath_the_supplied_root() {
        assert_eq!(
            resolve_relative_path(Path::new("/vault"), "Notes/Test.md").unwrap(),
            PathBuf::from("/vault/Notes/Test.md")
        );
    }
}
