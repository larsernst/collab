use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VaultKind {
    #[default]
    Local,
    Hosted,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultMeta {
    #[serde(default)]
    pub kind: VaultKind,
    pub id: String,
    pub name: String,
    pub path: String,
    pub last_opened: u64,
    /// Whether the vault files are encrypted at rest.
    #[serde(default)]
    pub is_encrypted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hosted_vault_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<MemberRole>,
}

#[cfg(test)]
mod tests {
    use super::{VaultKind, VaultMeta};

    #[test]
    fn legacy_vault_metadata_defaults_to_local() {
        let meta: VaultMeta = serde_json::from_str(
            r#"{"id":"vault-1","name":"Vault","path":"/vault","lastOpened":1,"isEncrypted":false}"#,
        )
        .expect("legacy metadata should deserialize");

        assert_eq!(meta.kind, VaultKind::Local);
        assert!(meta.server_url.is_none());
        assert!(meta.hosted_vault_id.is_none());
        assert!(meta.role.is_none());
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MemberRole {
    Viewer,
    Editor,
    Admin,
}

impl Default for MemberRole {
    fn default() -> Self {
        MemberRole::Editor
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultMember {
    pub user_id: String,
    pub user_name: String,
    pub role: MemberRole,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultConfig {
    pub id: String,
    pub name: String,
    pub known_users: Vec<KnownUser>,
    /// Legacy local-vault metadata. Readable for compatibility, never authoritative.
    #[serde(default)]
    pub owner: Option<String>,
    /// Legacy local-vault metadata. Readable for compatibility, never authoritative.
    #[serde(default)]
    pub members: Vec<VaultMember>,
    /// Reserved for future encryption support.
    #[serde(default)]
    pub is_encrypted: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnownUser {
    pub user_id: String,
    pub user_name: String,
    pub user_color: String,
    pub last_seen: u64,
}
