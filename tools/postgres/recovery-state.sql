-- Compare an owned test database and its restored copy without logging connection credentials.
SELECT jsonb_build_object(
    'deployment', (SELECT jsonb_agg(to_jsonb(row) ORDER BY singleton) FROM deployment row),
    'agreements', (SELECT jsonb_agg(to_jsonb(row) ORDER BY address) FROM agreements row),
    'activity', (SELECT jsonb_agg(to_jsonb(row) ORDER BY id) FROM activity row),
    'reconciliation', (SELECT jsonb_agg(to_jsonb(row) ORDER BY singleton) FROM reconciliation row),
    'migrations', (SELECT jsonb_agg(to_jsonb(row) ORDER BY version) FROM _sqlx_migrations row)
);
