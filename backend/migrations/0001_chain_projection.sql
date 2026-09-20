CREATE TABLE deployment (
    singleton SMALLINT PRIMARY KEY CHECK (singleton = 1),
    genesis_hash TEXT NOT NULL,
    program_id TEXT NOT NULL
);

CREATE TABLE agreements (
    address TEXT PRIMARY KEY,
    projection JSONB NOT NULL,
    CHECK (jsonb_typeof(projection) = 'object'),
    CHECK (projection ->> 'address' IS NOT NULL AND projection ->> 'address' = address)
);

CREATE TABLE reconciliation (
    singleton SMALLINT PRIMARY KEY CHECK (singleton = 1),
    finalized_slot NUMERIC(20, 0) NOT NULL CHECK (
        finalized_slot BETWEEN 0 AND 18446744073709551615
    ),
    observed_at BIGINT NOT NULL
);
