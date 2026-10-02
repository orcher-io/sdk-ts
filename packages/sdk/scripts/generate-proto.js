#!/usr/bin/env node
/**
 * Regenerate src/core/generated from the Orcher protocol definitions.
 *
 * The .proto files are taken from the `orcher-proto` crate the native binding
 * builds against, so the TypeScript types always describe the same protocol
 * as the Rust core. cargo resolves that crate, which means a local checkout
 * set up through native/.cargo/config.toml is honored too. Set
 * ORCHER_PROTO_DIR to generate from any other directory of .proto files.
 *
 * Needs `protoc` on PATH and a Rust toolchain (for `cargo metadata`). Only
 * this script needs them: the generated code is committed, so building and
 * testing the SDK do not.
 *
 * `index.ts` in the output directory is written by hand and kept.
 *
 * Usage: node scripts/generate-proto.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'src/core/generated');
const plugin = require.resolve('@protobuf-ts/plugin/bin/protoc-gen-ts', { paths: [root] });

function protoDirFromCargo() {
  const metadata = JSON.parse(
    execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--manifest-path', path.join(root, 'native/Cargo.toml')],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
  );
  const crate = metadata.packages.find((p) => p.name === 'orcher-proto');
  if (!crate) {
    throw new Error('orcher-proto is not a dependency of native/Cargo.toml');
  }
  console.log(`using orcher-proto ${crate.version}`);
  return path.join(path.dirname(crate.manifest_path), 'proto');
}

const protoDir = process.env.ORCHER_PROTO_DIR || protoDirFromCargo();
const protos = fs
  .readdirSync(protoDir)
  .filter((f) => f.endsWith('.proto'))
  .sort();
if (protos.length === 0) {
  throw new Error(`no .proto files in ${protoDir}`);
}

// Start clean so a proto that was removed upstream does not leave its old
// output behind.
for (const entry of fs.readdirSync(outDir)) {
  if (entry !== 'index.ts') {
    fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
  }
}

execFileSync(
  'protoc',
  [
    `--plugin=protoc-gen-ts=${plugin}`,
    `--ts_out=${outDir}`,
    // 64-bit integers as strings; the generated code is not written for this
    // package's strict compiler settings, so it is excluded from type-checking.
    '--ts_opt=long_type_string,ts_nocheck',
    `--proto_path=${protoDir}`,
    ...protos.map((p) => path.join(protoDir, p)),
  ],
  { stdio: 'inherit' }
);
console.log(`generated ${protos.join(', ')} from ${protoDir}`);

execFileSync(process.execPath, [path.join(__dirname, 'fix-generated-proto.js')], {
  stdio: 'inherit',
});
