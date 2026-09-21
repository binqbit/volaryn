CREATE TABLE deployment (
    singleton SMALLINT PRIMARY KEY CHECK (singleton = 1),
    genesis_hash TEXT NOT NULL,
    program_id TEXT NOT NULL
);

CREATE TABLE agreements (
    address TEXT PRIMARY KEY,
    projection JSONB NOT NULL,
    finalized_slot NUMERIC(20, 0) NOT NULL CHECK (
        finalized_slot BETWEEN 0 AND 18446744073709551615
    ),
    observed_at BIGINT NOT NULL,
    status TEXT GENERATED ALWAYS AS (projection ->> 'status') STORED NOT NULL,
    writer TEXT GENERATED ALWAYS AS (projection ->> 'writer') STORED NOT NULL,
    holder TEXT GENERATED ALWAYS AS (projection ->> 'holder') STORED,
    underlying_mint TEXT GENERATED ALWAYS AS (projection ->> 'underlyingMint') STORED NOT NULL,
    accept_before BIGINT GENERATED ALWAYS AS ((projection ->> 'acceptBefore')::BIGINT) STORED NOT NULL,
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

CREATE INDEX agreements_status_address ON agreements (status, address);
CREATE INDEX agreements_holder_address ON agreements (holder, address);
CREATE INDEX agreements_writer_address ON agreements (writer, address);
CREATE INDEX agreements_mint_status_address ON agreements (underlying_mint, status, address);
