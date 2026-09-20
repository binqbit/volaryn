use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    PgPool,
};
use std::sync::atomic::{AtomicU64, Ordering};

/// Every scenario owns a database inside the runner's disposable PostgreSQL cluster.
pub struct Database {
    pub options: PgConnectOptions,
    admin: PgPool,
    name: String,
}

impl Database {
    pub async fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let url = std::env::var("VOLARYN_TEST_DATABASE_URL")
            .expect("Run database checks through tools/test app or tools/test full");
        let admin_options: PgConnectOptions =
            url.parse().expect("Invalid test database connection");
        assert!(
            matches!(
                admin_options.get_host(),
                "127.0.0.1" | "localhost" | "database"
            ),
            "Tests require the isolated local cluster"
        );
        let admin = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(admin_options.clone())
            .await
            .unwrap();
        // Identifiers contain only a fixed prefix and locally generated integers.
        let name = format!(
            "volaryn_test_{}_{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE DATABASE {name} OWNER volaryn"
        )))
        .execute(&admin)
        .await
        .unwrap();
        let options = admin_options
            .database(&name)
            .username("volaryn")
            .password("volaryn-local");
        Self {
            options,
            admin,
            name,
        }
    }

    pub async fn close(self) {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DROP DATABASE {} WITH (FORCE)",
            self.name
        )))
        .execute(&self.admin)
        .await
        .unwrap();
        self.admin.close().await;
    }
}
