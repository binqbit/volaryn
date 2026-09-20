ALTER TABLE agreements
    ADD COLUMN finalized_slot NUMERIC(20, 0),
    ADD COLUMN observed_at BIGINT,
    ADD COLUMN status TEXT GENERATED ALWAYS AS (projection ->> 'status') STORED,
    ADD COLUMN writer TEXT GENERATED ALWAYS AS (projection ->> 'writer') STORED,
    ADD COLUMN holder TEXT GENERATED ALWAYS AS (projection ->> 'holder') STORED,
    ADD COLUMN underlying_mint TEXT GENERATED ALWAYS AS (projection ->> 'underlyingMint') STORED,
    ADD COLUMN accept_before BIGINT GENERATED ALWAYS AS ((projection ->> 'acceptBefore')::BIGINT) STORED;

UPDATE agreements
SET finalized_slot = (projection ->> 'finalizedSlot')::NUMERIC,
    observed_at = (projection ->> 'observedAt')::BIGINT,
    projection = projection - 'finalizedSlot' - 'observedAt';

ALTER TABLE agreements
    ALTER COLUMN finalized_slot SET NOT NULL,
    ALTER COLUMN observed_at SET NOT NULL,
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN writer SET NOT NULL,
    ALTER COLUMN underlying_mint SET NOT NULL,
    ALTER COLUMN accept_before SET NOT NULL,
    ADD CONSTRAINT agreement_slot_range CHECK (
        finalized_slot BETWEEN 0 AND 18446744073709551615
    );

CREATE INDEX agreements_status_address ON agreements (status, address);
CREATE INDEX agreements_holder_address ON agreements (holder, address);
CREATE INDEX agreements_writer_address ON agreements (writer, address);
CREATE INDEX agreements_mint_status_address ON agreements (underlying_mint, status, address);
