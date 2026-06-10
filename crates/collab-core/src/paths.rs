use std::path::{Component, Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

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

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum HostedPathError {
    #[error("Hosted paths must be non-empty relative POSIX paths")]
    InvalidPath,
    #[error("Hosted file names are not portable")]
    InvalidName,
    #[error(".collab is reserved at the vault root")]
    ReservedRoot,
    #[error("Hosted path exceeds the maximum length")]
    TooLong,
}

pub fn normalize_hosted_name(name: &str) -> Result<(String, String), HostedPathError> {
    let normalized = name.nfc().collect::<String>();
    let invalid = normalized.is_empty()
        || normalized == "."
        || normalized == ".."
        || normalized.as_bytes().len() > 255
        || normalized.ends_with(['.', ' '])
        || normalized
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\' | '\0'));
    if invalid {
        return Err(HostedPathError::InvalidName);
    }
    let stem = normalized
        .split_once('.')
        .map(|(value, _)| value)
        .unwrap_or(&normalized)
        .to_ascii_lowercase();
    if matches!(
        stem.as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    ) {
        return Err(HostedPathError::InvalidName);
    }
    let comparison_key = normalized.to_lowercase();
    Ok((normalized, comparison_key))
}

pub fn normalize_hosted_path(path: &str) -> Result<String, HostedPathError> {
    if path.is_empty()
        || path.starts_with('/')
        || path.ends_with('/')
        || path.contains('\\')
        || path.contains("//")
    {
        return Err(HostedPathError::InvalidPath);
    }
    let mut components = Vec::new();
    for component in path.split('/') {
        let (name, _) = normalize_hosted_name(component)?;
        components.push(name);
    }
    if components
        .first()
        .is_some_and(|name| name.eq_ignore_ascii_case(".collab"))
    {
        return Err(HostedPathError::ReservedRoot);
    }
    let normalized = components.join("/");
    if normalized.as_bytes().len() > 4096 {
        return Err(HostedPathError::TooLong);
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_hosted_name, normalize_hosted_path, normalize_relative_path,
        resolve_relative_path, HostedPathError, PathError,
    };
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

    #[test]
    fn hosted_paths_normalize_unicode_and_case_keys() {
        assert_eq!(
            normalize_hosted_name("Cafe\u{301}.md").unwrap(),
            ("Café.md".into(), "café.md".into())
        );
        assert_eq!(
            normalize_hosted_path("Notes/Cafe\u{301}.md").unwrap(),
            "Notes/Café.md"
        );
    }

    #[test]
    fn hosted_paths_reject_reserved_and_non_portable_names() {
        assert_eq!(
            normalize_hosted_path(".collab/secret").unwrap_err(),
            HostedPathError::ReservedRoot
        );
        assert_eq!(
            normalize_hosted_path("../outside").unwrap_err(),
            HostedPathError::InvalidName
        );
        assert_eq!(
            normalize_hosted_name("CON.txt").unwrap_err(),
            HostedPathError::InvalidName
        );
        assert_eq!(
            normalize_hosted_path("Notes\\bad.md").unwrap_err(),
            HostedPathError::InvalidPath
        );
    }
}
