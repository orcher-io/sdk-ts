# Contributing

Thanks for your interest in the Orcher TypeScript SDK. Bug reports, fixes and
improvements are welcome. For larger changes, please open an issue first so we
can agree on the approach before you spend time on it.

## Repository layout

```
packages/sdk/
├── src/          TypeScript source: worker, workflow and task contexts,
│                 client, decorators and dependency injection, testing utilities
├── native/       Rust crate (Neon) that binds the SDK to orcher-sdk-core
├── npm/          One package per platform, carrying the prebuilt binding
└── scripts/      Build, packaging and protocol generation helpers
contract/         Live contract suite, run against a real engine
```

## Building and testing

You need Node.js 22 or later (CI tests 22 and 24) and a stable Rust toolchain.

```bash
npm ci
npm run build:native --workspace packages/sdk   # Rust binding -> packages/sdk/native/orcher_core.node
npm run build:ts --workspace packages/sdk
npm run type-check --workspace packages/sdk
npm run type-check:tests --workspace packages/sdk
npm test --workspace packages/sdk
npm run smoke-test --workspace packages/sdk     # pack, install into a new project, import
```

These are the steps CI runs on every pull request, on Linux and macOS. The unit
tests run in memory and need no engine. The smoke test packs `@orcher/sdk`
and the platform package for your machine, installs both tarballs into a
fresh project and imports `@orcher/sdk` and `@orcher/sdk/testing` from
TypeScript, CommonJS and ESM.

A binding built in the checkout (`packages/sdk/dist/native/orcher_core.node`)
always takes precedence over an installed platform package, so the contract
suite runs against your build.

The native crate depends on
[`orcher-sdk-core`](https://github.com/orcher-io/sdk-core) and
[`orcher-proto`](https://github.com/orcher-io/protos), taken from crates.io at
the versions in `packages/sdk/native/Cargo.toml`. To change one of them and
this SDK together, check them out next to this repository and build against
your checkouts:

```bash
cp packages/sdk/native/.cargo/config.example.toml packages/sdk/native/.cargo/config.toml
```

`.cargo/config.toml` is git-ignored, and the override is not recorded in
`Cargo.lock`, so it only affects your machine.

## Generated protocol code

`packages/sdk/src/core/generated/` holds TypeScript generated from the
`.proto` files of the `orcher-proto` crate that the native binding builds
against, so both sides speak the same protocol. It is committed; building and
testing need nothing extra. After moving to a new `orcher-proto` version,
regenerate it:

```bash
npm run proto:generate --workspace packages/sdk
```

This needs [`protoc`](https://protobuf.dev/installation/) on your `PATH` and
the Rust toolchain (it asks `cargo metadata` where the crate's protos are, so a
local checkout set up as above is used too). Set `ORCHER_PROTO_DIR` to generate
from another directory of `.proto` files. `index.ts` in that directory is kept
by hand.

## Contract suite

`contract/` drives a real worker against a real engine and checks the durable
behavior end to end. It is not part of the unit tests; see
[contract/README.md](contract/README.md) for how to run it. Run it after any
change to how the worker executes workflows or tasks.

## Commit messages and releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org):
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`, `chore:`. Mark a
breaking change with `!` (for example `feat!: ...`).

Releases are cut by release-please from these messages, so the type you pick
decides the next version and the changelog entry. While the SDK is below 1.0,
`feat` and `fix` bump the patch version and a breaking change bumps the minor
version. `docs`, `refactor`, `test`, `ci` and `chore` commits do not trigger a
release on their own.

release-please keeps one pull request open with the next version and its
changelog. The version lives in `packages/sdk/package.json`, in every platform
package under `packages/sdk/npm/`, and in the SDK's `optionalDependencies`
pins on them; release-please bumps them all together, and a unit test fails
if they ever disagree. Merging the release pull request is the release: it
tags `v<version>`, builds the binding for every platform and publishes the
platform packages, then `@orcher/sdk`, to npm with provenance.

### Platforms

Prebuilt bindings are published for macOS (arm64, x64) and Linux (x64, arm64;
glibc 2.17 or later, and musl). To add a platform, add its package under
`packages/sdk/npm/`, its name to `NATIVE_TARGETS` in
`packages/sdk/src/core/native.ts`, its pins to `optionalDependencies` and
`release-please-config.json`, and a build to the `bindings` matrix in
`.github/workflows/release.yml`.

## Pull requests

- Keep each pull request focused on one change.
- Add or update tests for any behavior you change.
- Make sure the build, type-checks and tests above pass locally.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License, Version 2.0](LICENSE).
