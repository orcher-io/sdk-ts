# orcher-core-native

The Rust crate behind the Orcher TypeScript SDK (`@orcher/sdk`). It is a
[Neon](https://neon-rs.dev/) N-API binding over
[`orcher-sdk-core`](https://github.com/orcher-io/sdk-core), built as a `cdylib`
named `orcher_core` and loaded by the TypeScript package as `orcher_core.node`.

sdk-core does the gRPC work: polling, the workflow state machines, replay
validation and heartbeats. This crate exposes it to JavaScript as plain
functions (`clientConnect`, `serviceStart`, `pollWorkflowTask`, and so on; see
`src/lib.rs` for the full list), and the TypeScript side runs the workflow and
task handlers. Async calls return JavaScript promises backed by a shared Tokio
runtime.

## Building

You need a stable Rust toolchain and Node.js 18 or later. From the repository
root:

```bash
npm run build:native --workspace packages/sdk
```

This runs `cargo build --release` on this crate, copies the built library
(`liborcher_core.dylib` or `liborcher_core.so`) to `native/orcher_core.node`,
and copies that to `dist/native/orcher_core.node`, where the SDK looks for a
locally built binding. `CARGO_TARGET_DIR` is honored if set.

The SDK loads the binding from, in order: the path in the
`ORCHER_NATIVE_MODULE` environment variable, the prebuilt platform package for
the current machine, and the local build in `dist/native/`. To test a binding
built elsewhere, point `ORCHER_NATIVE_MODULE` at the `.node` file.

## Building against local sdk-core and protos checkouts

`Cargo.toml` takes `orcher-sdk-core` and `orcher-proto` from crates.io. To
change one of them together with this crate, check out
[`sdk-core`](https://github.com/orcher-io/sdk-core) and
[`protos`](https://github.com/orcher-io/protos) next to this repository, then,
from this directory:

```bash
cp .cargo/config.example.toml .cargo/config.toml
```

`.cargo/config.toml` is git-ignored. Its `paths` override applies at build time
only and is not recorded in `Cargo.lock`, so it affects only your machine.

## Source layout

```
src/
├── lib.rs         Module entry point: logging setup and the exported JavaScript functions
├── client.rs      Workflow client and workflow handles: connect, start, query, update,
│                  send event, cancel, terminate, reset, describe, list, search
├── worker.rs      Worker: sdk-core workflow, task and actor drivers, fan-out of work to
│                  per-slot channels, completion, failure, heartbeats, shutdown
├── actor.rs       Actor operations: polling, completion, client invocation, state RPCs,
│                  handler registration
├── codec.rs       Gzip, encryption and chained payload codecs over raw buffers
├── runtime.rs     Global Tokio runtime, future-to-promise bridge, JS/JSON value conversion
├── error_code.rs  Tags errors with a `[CODE]` prefix that the TypeScript side maps to
│                  its error classes
├── types.rs       Helpers that read typed properties from JavaScript objects
├── error.rs       Empty module
└── utils.rs       Empty module
```

## Tests

The Rust unit tests in this crate are few (see `src/lib.rs`):

```bash
cargo test --manifest-path packages/sdk/native/Cargo.toml
```

The TypeScript tests cover how the SDK calls the binding, mostly against a
mocked native module:

```bash
npm test --workspace packages/sdk
```

The contract suite in `contract/` at the repository root drives the built
binding against a real engine; see `contract/README.md`.

## License

Apache-2.0. See the `LICENSE` file at the repository root.
