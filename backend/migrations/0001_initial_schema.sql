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
    creator TEXT GENERATED ALWAYS AS (projection ->> 'creator') STORED NOT NULL,
    side TEXT GENERATED ALWAYS AS (projection ->> 'side') STORED NOT NULL CHECK (side IN ('writer', 'holder')),
    writer TEXT GENERATED ALWAYS AS (projection ->> 'writer') STORED,
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
CREATE INDEX agreements_creator_address ON agreements (creator, address);
CREATE INDEX agreements_side_status_address ON agreements (side, status, address);
CREATE INDEX agreements_mint_status_address ON agreements (underlying_mint, status, address);

-- Signed attempts are durable independently of the finalized agreement projection.
CREATE TABLE activity (
    id BIGSERIAL UNIQUE NOT NULL,
    signature TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    agreement TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'activate', 'exercise', 'cancel', 'reclaim', 'cleanup')),
    side TEXT NOT NULL CHECK (side IN ('writer', 'holder')),
    actor_role TEXT NOT NULL CHECK (actor_role IN ('writer', 'holder')),
    created_terms JSONB,
    last_valid_block_height NUMERIC(20, 0) NOT NULL CHECK (last_valid_block_height BETWEEN 0 AND 18446744073709551615),
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'provisional', 'finalized', 'failed', 'expired', 'reconciled', 'unresolved'
    )),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    checked_at BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX activity_owner_id ON activity (owner, id DESC);
CREATE INDEX activity_pending_check ON activity (checked_at, id)
    WHERE status IN ('pending', 'provisional', 'unresolved');
