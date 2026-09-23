-- Signed attempts are durable independently of the finalized agreement projection.
CREATE TABLE activity (
    id BIGSERIAL UNIQUE NOT NULL,
    signature TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    agreement TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'activate', 'exercise', 'cancel', 'reclaim', 'cleanup')),
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
