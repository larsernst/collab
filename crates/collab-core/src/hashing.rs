use sha2::{Digest, Sha256};

pub fn sha256_bytes(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    hex::encode(hasher.finalize())
}

pub fn sha256_text(content: &str) -> String {
    sha256_bytes(content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::{sha256_bytes, sha256_text};

    #[test]
    fn hashes_text_and_bytes_consistently() {
        assert_eq!(sha256_text("collab"), sha256_bytes(b"collab"));
        assert_eq!(
            sha256_text("collab"),
            "2b3a4a39b14b972a495706b9b9a0dfa5b16a0057c5f958ce7fb06ea88a7270a9"
        );
    }
}
