# Validator seccomp profile

`validator.json` is the [Moby default profile at commit `245180c51918481c0525424b3ee025d2b435d46c`](https://github.com/moby/profiles/blob/245180c51918481c0525424b3ee025d2b435d46c/seccomp/default.json), with one appended rule allowing `io_uring_setup`, `io_uring_enter`, and `io_uring_register`. The upstream file's SHA-256 is `785b2429264afba4d594320337cb17f144f3c7d51585f9805eef72e28f4f9334`; its Apache 2.0 license is retained in `LICENSE`.

[Agave 4.0.3 requires io_uring](https://github.com/anza-xyz/agave/blob/v4.0.3/fs/src/dirs.rs). [Docker blocks these calls by default](https://docs.docker.com/engine/security/seccomp/), causing the validator to panic before RPC readiness. This profile keeps the upstream default-deny policy and all other rules. It is applied only to the disposable local validator, without privileged mode, added capabilities, or changes to the host's security policy. The application, database, and bootstrap retain Docker's default profile.

The Docker host must support the io_uring features required by Agave. Container permissions cannot enable a kernel feature disabled by the host administrator. Native contract tests use LiteSVM and do not need this profile.

The profile is committed and read by Compose from the repository; startup downloads no security configuration. When updating it, review the pinned upstream diff, preserve the three-call exception, update its provenance and baseline fingerprint test, and run `./tools/test full` on Docker to check cold startup and retained-ledger recovery.
