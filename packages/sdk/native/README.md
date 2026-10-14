# orcher-core-native

The Rust crate behind the Orcher TypeScript SDK (`@orcher/sdk`). It is a
[Neon](https://neon-rs.dev/) N-API binding over
[`orcher-sdk-host`](https://github.com/orcher-io/sdk-core) (the worker) and
[`orcher-sdk-core`](https://github.com/orcher-io/sdk-core) (the client, the
codecs and the kernel protocol), built as a `cdylib` named `orcher_core` and
loaded by the TypeScript package as `orcher_core.node`.

The worker host is the worker's plumbing, shared with the Rust and Python SDKs:
core's workflow, task and actor drivers built from one configuration, the
worker's registration and heartbeats, task heartbeats and cancellation,
sessions, actor state, and a draining shutdown. This crate exposes it to
JavaScript as a handle (`hostStart`) and pulls: `hostNextActivation`,
`hostNextTask` and `hostNextActorOperation` hand over one piece of work as its
protobuf encoding (`orcher.kernel.v1.RunActivation`,
`orcher.host.v1.TaskAssignment`, `orcher.host.v1.ActorOperation`), and the
matching `hostComplete*` take the outcome back the same way. A pull resolves
`null` once the host has stopped. The TypeScript side decodes the messages with
protobuf-ts, runs the workflow, task and actor handlers, and pulls only when it
has room to run what a pull brings. The client calls are plain functions
(`clientConnect`, `workflowHandleGetResult`, and so on; see `src/lib.rs` for the
full list). Async calls return JavaScript promises backed by a shared Tokio
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

`Cargo.toml` takes `orcher-sdk-host`, `orcher-sdk-core` and `orcher-proto` from
crates.io. To change one of them together with this crate, check out
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
│                  send event, cancel, terminate, reset, describe, list, search; actor
│                  invocation
├── host.rs        Worker: the worker host's start, pulls and completions (protobuf in and
│                  out), task heartbeats and cancellation, actor state, shutdown
├── kernel.rs      The kernel protocol for replaying recorded activations without an engine
├── codec.rs       Gzip, encryption and chained payload codecs over raw buffers
├── runtime.rs     Global Tokio runtime, future-to-promise bridge, JS/JSON value conversion
├── error_code.rs  Tags errors with a `[CODE]` prefix that the TypeScript side maps to
│                  its error classes
├── types.rs       Helpers that read typed properties from JavaScript objects
├── error.rs       Empty module
└── utils.rs       Empty module
```

## Tests

The Rust unit tests in this crate are few (see `src/lib.rs` and `src/host.rs`):

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
