use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;

pub async fn connect_and_migrate(database_url: &str) -> Result<PgPool, DatabaseError> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect(database_url)
        .await?;
    migrate(&pool).await?;
    Ok(pool)
}

pub async fn migrate(pool: &PgPool) -> Result<(), DatabaseError> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

pub async fn is_ready(pool: &PgPool) -> bool {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await
        .is_ok()
}

#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    #[error(transparent)]
    Migration(#[from] sqlx::migrate::MigrateError),
}

#[cfg(test)]
mod tests {
    use super::{is_ready, migrate};
    use sqlx::postgres::PgPoolOptions;

    #[tokio::test]
    async fn migrations_are_idempotent_when_test_database_is_available() {
        let Ok(url) = std::env::var("COLLAB_TEST_DATABASE_URL") else {
            return;
        };
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        migrate(&pool).await.unwrap();
        assert!(is_ready(&pool).await);
    }
}
