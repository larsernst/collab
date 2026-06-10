use async_trait::async_trait;
use collab_core::sha256_bytes;
use std::path::{Path, PathBuf};
use tokio::fs;

#[async_trait]
pub trait BlobStorage: Send + Sync {
    async fn put(&self, content: &[u8]) -> Result<String, StorageError>;
    async fn get(&self, digest: &str) -> Result<Option<Vec<u8>>, StorageError>;
    async fn exists(&self, digest: &str) -> Result<bool, StorageError>;
    async fn delete(&self, digest: &str) -> Result<(), StorageError>;
    async fn health_check(&self) -> Result<(), StorageError>;
    async fn total_bytes(&self) -> Result<u64, StorageError>;
}

#[derive(Debug, Clone)]
pub struct FileSystemBlobStorage {
    root: PathBuf,
}

impl FileSystemBlobStorage {
    pub async fn new(root: impl AsRef<Path>) -> Result<Self, StorageError> {
        let storage = Self {
            root: root.as_ref().to_path_buf(),
        };
        fs::create_dir_all(&storage.root).await?;
        storage.health_check().await?;
        Ok(storage)
    }

    fn validate_digest(digest: &str) -> Result<(), StorageError> {
        if digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            Ok(())
        } else {
            Err(StorageError::InvalidDigest)
        }
    }

    fn path_for_digest(&self, digest: &str) -> Result<PathBuf, StorageError> {
        Self::validate_digest(digest)?;
        Ok(self.root.join(&digest[..2]).join(&digest[2..]))
    }
}

#[async_trait]
impl BlobStorage for FileSystemBlobStorage {
    async fn put(&self, content: &[u8]) -> Result<String, StorageError> {
        let digest = sha256_bytes(content);
        let target = self.path_for_digest(&digest)?;
        if fs::try_exists(&target).await? {
            return Ok(digest);
        }
        let parent = target.parent().ok_or(StorageError::InvalidDigest)?;
        fs::create_dir_all(parent).await?;
        let temp = target.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
        fs::write(&temp, content).await?;
        match fs::rename(&temp, &target).await {
            Ok(()) => {}
            Err(error) if fs::try_exists(&target).await? => {
                let _ = fs::remove_file(&temp).await;
                tracing::debug!(%error, "blob was written concurrently");
            }
            Err(error) => return Err(error.into()),
        }
        Ok(digest)
    }

    async fn get(&self, digest: &str) -> Result<Option<Vec<u8>>, StorageError> {
        let path = self.path_for_digest(digest)?;
        if !fs::try_exists(&path).await? {
            return Ok(None);
        }
        Ok(Some(fs::read(path).await?))
    }

    async fn exists(&self, digest: &str) -> Result<bool, StorageError> {
        Ok(fs::try_exists(self.path_for_digest(digest)?).await?)
    }

    async fn delete(&self, digest: &str) -> Result<(), StorageError> {
        let path = self.path_for_digest(digest)?;
        if fs::try_exists(&path).await? {
            fs::remove_file(path).await?;
        }
        Ok(())
    }

    async fn health_check(&self) -> Result<(), StorageError> {
        fs::create_dir_all(&self.root).await?;
        let probe = self.root.join(format!(".health-{}", uuid::Uuid::new_v4()));
        fs::write(&probe, b"ok").await?;
        fs::remove_file(probe).await?;
        Ok(())
    }

    async fn total_bytes(&self) -> Result<u64, StorageError> {
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || {
            let mut total = 0_u64;
            let mut pending = vec![root];
            while let Some(path) = pending.pop() {
                for entry in std::fs::read_dir(path)? {
                    let entry = entry?;
                    let metadata = entry.metadata()?;
                    if metadata.is_dir() {
                        pending.push(entry.path());
                    } else {
                        total = total.saturating_add(metadata.len());
                    }
                }
            }
            Ok::<_, std::io::Error>(total)
        })
        .await
        .map_err(|error| StorageError::Task(error.to_string()))?
        .map_err(StorageError::Io)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("invalid SHA-256 digest")]
    InvalidDigest,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("storage task failed: {0}")]
    Task(String),
}

#[cfg(test)]
mod tests {
    use super::{BlobStorage, FileSystemBlobStorage, StorageError};

    #[tokio::test]
    async fn filesystem_storage_round_trips_and_deduplicates_blobs() {
        let dir = tempfile::tempdir().unwrap();
        let storage = FileSystemBlobStorage::new(dir.path()).await.unwrap();

        let first = storage.put(b"hello").await.unwrap();
        let second = storage.put(b"hello").await.unwrap();

        assert_eq!(first, second);
        assert!(storage.exists(&first).await.unwrap());
        assert_eq!(storage.get(&first).await.unwrap(), Some(b"hello".to_vec()));
        storage.delete(&first).await.unwrap();
        assert!(!storage.exists(&first).await.unwrap());
    }

    #[tokio::test]
    async fn filesystem_storage_rejects_untrusted_digest_paths() {
        let dir = tempfile::tempdir().unwrap();
        let storage = FileSystemBlobStorage::new(dir.path()).await.unwrap();
        assert!(matches!(
            storage.get("../../etc/passwd").await,
            Err(StorageError::InvalidDigest)
        ));
    }

    #[tokio::test]
    async fn filesystem_storage_health_check_verifies_writes() {
        let dir = tempfile::tempdir().unwrap();
        let storage = FileSystemBlobStorage::new(dir.path()).await.unwrap();
        storage.health_check().await.unwrap();
    }
}
