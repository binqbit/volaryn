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
RUN ./tools/format --check && ./tools/test fast
ENTRYPOINT ["./tools/test", "fast"]
