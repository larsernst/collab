use serde::Deserialize;
use std::{
    env, fs,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
};

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    Pretty,
    Json,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ServerConfig {
    pub host: IpAddr,
    pub port: u16,
    pub database_url: String,
    pub blob_dir: PathBuf,
    pub admin_web_dir: PathBuf,
    pub browser_secure_cookies: bool,
    pub session_ttl_hours: i64,
    pub native_access_ttl_minutes: i64,
    pub native_refresh_ttl_days: i64,
    pub max_file_bytes: usize,
    pub log_filter: String,
    pub log_format: LogFormat,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".parse().expect("default host is valid"),
            port: 8787,
            database_url: "postgres://collab:collab@127.0.0.1:5432/collab".into(),
            blob_dir: PathBuf::from("server-data/blobs"),
            admin_web_dir: PathBuf::from("apps/admin-web/dist"),
            browser_secure_cookies: false,
            session_ttl_hours: 12,
            native_access_ttl_minutes: 15,
            native_refresh_ttl_days: 30,
            max_file_bytes: 25 * 1024 * 1024,
            log_filter: "collab_server=info,tower_http=info".into(),
            log_format: LogFormat::Pretty,
        }
    }
}

impl ServerConfig {
    pub fn load() -> Result<Self, ConfigError> {
        let mut config = if let Ok(path) = env::var("COLLAB_CONFIG_FILE") {
            let raw = fs::read_to_string(&path).map_err(|source| ConfigError::ReadFile {
                path: path.clone(),
                source,
            })?;
            serde_json::from_str(&raw).map_err(|source| ConfigError::ParseFile { path, source })?
        } else {
            Self::default()
        };

        config.apply_env()?;
        config.validate()?;
        Ok(config)
    }

    pub fn bind_address(&self) -> SocketAddr {
        SocketAddr::new(self.host, self.port)
    }

    fn apply_env(&mut self) -> Result<(), ConfigError> {
        if let Ok(value) = env::var("COLLAB_HOST") {
            self.host = value
                .parse()
                .map_err(|_| ConfigError::Invalid("COLLAB_HOST"))?;
        }
        if let Ok(value) = env::var("COLLAB_PORT") {
            self.port = value
                .parse()
                .map_err(|_| ConfigError::Invalid("COLLAB_PORT"))?;
        }
        if let Ok(value) = env::var("COLLAB_DATABASE_URL") {
            self.database_url = value;
        }
        if let Ok(value) = env::var("COLLAB_BLOB_DIR") {
            self.blob_dir = value.into();
        }
        if let Ok(value) = env::var("COLLAB_ADMIN_WEB_DIR") {
            self.admin_web_dir = value.into();
        }
        if let Ok(value) = env::var("COLLAB_BROWSER_SECURE_COOKIES") {
            self.browser_secure_cookies = value
                .parse()
                .map_err(|_| ConfigError::Invalid("COLLAB_BROWSER_SECURE_COOKIES"))?;
        }
        if let Ok(value) = env::var("COLLAB_SESSION_TTL_HOURS") {
            self.session_ttl_hours = value
                .parse()
                .map_err(|_| ConfigError::Invalid("COLLAB_SESSION_TTL_HOURS"))?;
        }
        if let Ok(value) = env::var("COLLAB_NATIVE_ACCESS_TTL_MINUTES") {
            self.native_access_ttl_minutes = value
                .parse()
                .map_err(|_| ConfigError::Invalid("COLLAB_NATIVE_ACCESS_TTL_MINUTES"))?;
        }
        if let Ok(value) = env::var("COLLAB_NATIVE_REFRESH_TTL_DAYS") {
            self.native_refresh_ttl_days = value
                .parse()
                .map_err(|_| ConfigError::Invalid("COLLAB_NATIVE_REFRESH_TTL_DAYS"))?;
        }
        if let Ok(value) = env::var("COLLAB_MAX_FILE_BYTES") {
            self.max_file_bytes = value
                .parse()
                .map_err(|_| ConfigError::Invalid("COLLAB_MAX_FILE_BYTES"))?;
        }
        if let Ok(value) = env::var("COLLAB_LOG") {
            self.log_filter = value;
        }
        if let Ok(value) = env::var("COLLAB_LOG_FORMAT") {
            self.log_format = match value.as_str() {
                "pretty" => LogFormat::Pretty,
                "json" => LogFormat::Json,
                _ => return Err(ConfigError::Invalid("COLLAB_LOG_FORMAT")),
            };
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.port == 0 {
            return Err(ConfigError::Invalid("COLLAB_PORT"));
        }
        if !self.database_url.starts_with("postgres://")
            && !self.database_url.starts_with("postgresql://")
        {
            return Err(ConfigError::Invalid("COLLAB_DATABASE_URL"));
        }
        if self.blob_dir.as_os_str().is_empty() {
            return Err(ConfigError::Invalid("COLLAB_BLOB_DIR"));
        }
        if self.admin_web_dir.as_os_str().is_empty() {
            return Err(ConfigError::Invalid("COLLAB_ADMIN_WEB_DIR"));
        }
        if self.session_ttl_hours <= 0 || self.session_ttl_hours > 24 * 30 {
            return Err(ConfigError::Invalid("COLLAB_SESSION_TTL_HOURS"));
        }
        if self.native_access_ttl_minutes <= 0 || self.native_access_ttl_minutes > 24 * 60 {
            return Err(ConfigError::Invalid("COLLAB_NATIVE_ACCESS_TTL_MINUTES"));
        }
        if self.native_refresh_ttl_days <= 0 || self.native_refresh_ttl_days > 365 {
            return Err(ConfigError::Invalid("COLLAB_NATIVE_REFRESH_TTL_DAYS"));
        }
        if self.max_file_bytes == 0 || self.max_file_bytes > 1024 * 1024 * 1024 {
            return Err(ConfigError::Invalid("COLLAB_MAX_FILE_BYTES"));
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("invalid configuration value for {0}")]
    Invalid(&'static str),
    #[error("failed to read configuration file {path}: {source}")]
    ReadFile {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to parse configuration file {path}: {source}")]
    ParseFile {
        path: String,
        source: serde_json::Error,
    },
}

#[cfg(test)]
mod tests {
    use super::{LogFormat, ServerConfig};
    use std::path::PathBuf;

    #[test]
    fn default_configuration_is_safe_for_local_development() {
        let config = ServerConfig::default();
        assert_eq!(config.bind_address().to_string(), "127.0.0.1:8787");
        assert_eq!(config.blob_dir, PathBuf::from("server-data/blobs"));
        assert_eq!(config.max_file_bytes, 25 * 1024 * 1024);
        assert_eq!(config.log_format, LogFormat::Pretty);
        config.validate().unwrap();
    }

    #[test]
    fn validation_rejects_non_postgres_database_urls() {
        let config = ServerConfig {
            database_url: "sqlite://collab.db".into(),
            ..ServerConfig::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn bind_address_supports_ipv6_hosts() {
        let config = ServerConfig {
            host: "::1".parse().unwrap(),
            ..ServerConfig::default()
        };
        assert_eq!(config.bind_address().to_string(), "[::1]:8787");
    }

    #[test]
    fn validation_rejects_invalid_file_size_limits() {
        let config = ServerConfig {
            max_file_bytes: 0,
            ..ServerConfig::default()
        };
        assert!(config.validate().is_err());

        let config = ServerConfig {
            max_file_bytes: 1024 * 1024 * 1024 + 1,
            ..ServerConfig::default()
        };
        assert!(config.validate().is_err());
    }
}
