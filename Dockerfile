# syntax=docker/dockerfile:1.7
FROM rust:1.98.1-bookworm@sha256:828077e0f5ed0401fbd9cb5b4d5dedca23bd13c7fe032f3e8b7313e7acd2a57f AS contract-tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl build-essential pkg-config libssl-dev libudev-dev clang cmake python3 shfmt=3.6.0-1+b2 \
    && rm -rf /var/lib/apt/lists/*
RUN rustup component add clippy rustfmt \
    && cargo install --locked dprint --version 0.57.4 \
    && cargo install --locked --version 1.0.2 anchor-cli \
    && cargo install --locked --version 4.0.0 cargo-build-sbf \
    && cargo build-sbf --install-only --tools-version v1.53
WORKDIR /workspace

FROM contract-tools AS contract-tests
COPY . .
# Enforce formatting in CI, then prepare the network-isolated test run.
RUN ./tools/format --check && python3 -m unittest discover -s tests/release && ./tools/test fast
ENTRYPOINT ["./tools/test", "fast"]

FROM contract-tests AS application-rust
RUN ./tools/rustup/cargo test --locked -p volaryn-backend --features localnet --no-run \
    && ./tools/rustup/cargo build --locked --release -p volaryn-backend --features localnet \
    && target/release/export-openapi > /tmp/openapi.json \
    && cmp packages/api/openapi.json /tmp/openapi.json

FROM application-rust AS backend-tests
ENTRYPOINT ["./tools/rustup/cargo", "test", "--locked", "-p", "volaryn-backend", "--features", "localnet"]

FROM postgres:17.11-bookworm@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652 AS database
COPY tools/postgres/init.sql /docker-entrypoint-initdb.d/10-volaryn.sql

FROM node:24.15.0-bookworm@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940 AS application-js
WORKDIR /workspace
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm ci
COPY . .
ARG VITE_WALLETCONNECT_PROJECT_ID
RUN npm run check:generated && npm run lint && npm run typecheck && npm test \
    && npm run format:check && npm run build && npm run build:live && npm run check:live

FROM application-js AS bootstrap
RUN mkdir /deployment && chown node:node /deployment
COPY --from=application-rust /workspace/target/deploy/volaryn.so /fixtures/volaryn.so
USER node

FROM application-js AS browser-tests
RUN npx playwright install --with-deps chromium
CMD ["node_modules/.bin/tsx", "tools/localnet/browser-container.ts"]

FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3 AS validator
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl bzip2 libstdc++6 libudev1 \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fL --retry 3 https://github.com/anza-xyz/agave/releases/download/v4.0.3/solana-release-x86_64-unknown-linux-gnu.tar.bz2 -o /tmp/agave.tar.bz2 \
    && echo '50a6ed0474c958e1ce3fba298f45fc1cd3117db5c5df253cc0c7d8c827e813a8  /tmp/agave.tar.bz2' | sha256sum -c - \
    && tar -xjf /tmp/agave.tar.bz2 -C /tmp solana-release/bin/solana solana-release/bin/solana-test-validator \
    && mv /tmp/solana-release/bin/* /usr/local/bin/ \
    && rm -rf /tmp/agave.tar.bz2 /tmp/solana-release \
    && solana-test-validator --version && solana --version \
    && useradd --create-home --uid 10001 validator \
    && mkdir /ledger && chown validator:validator /ledger
COPY --from=application-rust /workspace/target/deploy/volaryn.so /fixtures/volaryn.so
COPY --from=application-rust /workspace/target/fixtures/ /fixtures/
USER validator
ENTRYPOINT ["solana-test-validator"]

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgcc-s1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 app \
    && mkdir /deployment && chown app:app /deployment
USER app
EXPOSE 8080
ENTRYPOINT ["volaryn"]

FROM contract-tests AS live-rust
ARG RELEASE_REVISION
RUN ./tools/rustup/cargo test --locked -p volaryn-backend --no-default-features --test config --test deployment --test admission --test release \
    && test "${#RELEASE_REVISION}" -eq 40 \
    && VOLARYN_RELEASE_REVISION="$RELEASE_REVISION" \
       VOLARYN_PROGRAM_SHA256="$(sha256sum target/deploy/volaryn.so | cut -d ' ' -f 1)" \
       ./tools/rustup/cargo build --locked --release -p volaryn-backend --no-default-features \
    && target/release/export-openapi > /tmp/openapi.json \
    && cmp packages/api/openapi.json /tmp/openapi.json

FROM application-js AS release-files
ARG RELEASE_REVISION
COPY --from=live-rust /workspace/target/deploy/volaryn.so target/deploy/volaryn.so
RUN node tools/release/metadata.mjs /release "$RELEASE_REVISION"

FROM runtime AS app-live
ARG RELEASE_REVISION
LABEL org.opencontainers.image.title="Volaryn" org.opencontainers.image.revision="$RELEASE_REVISION"
COPY --from=live-rust /workspace/target/release/volaryn /usr/local/bin/volaryn
COPY --from=application-js /workspace/frontend/dist-live/ /app/frontend/
COPY --from=release-files /release/ /app/release/

FROM runtime AS app
COPY --from=application-rust /workspace/target/release/volaryn /usr/local/bin/volaryn
COPY --from=application-js /workspace/frontend/dist/ /app/frontend/
