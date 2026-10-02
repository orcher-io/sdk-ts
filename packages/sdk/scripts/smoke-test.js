#!/usr/bin/env node
/**
 * Pack @orcher/sdk and the platform package for this machine, install both
 * tarballs into a fresh project, and use them the way a consumer would:
 *
 * - pack the SDK as it is published, with the platform packages added to its
 *   package.json as optionalDependencies by prepare-publish.js, and check the
 *   installed package lists every one at the SDK's version;
 * - type-check imports of `@orcher/sdk` and `@orcher/sdk/testing` under both
 *   the classic (`node`) and the Node 16+ (`nodenext`) module resolution;
 * - require both entry points from CommonJS and import them from ESM;
 * - load the native binding, which must come from the platform package (the
 *   SDK tarball carries none), and run a workflow in the in-memory test
 *   environment.
 *
 * Needs `npm run build:native` and `npm run build:ts` first. The project is
 * created in a temporary directory, or in SMOKE_DIR, and removed afterwards
 * unless SMOKE_KEEP is set.
 *
 * Usage: node scripts/smoke-test.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { nativeTarget, isMusl, NATIVE_TARGETS, NATIVE_PACKAGE_SCOPE } = require(
  path.join(root, 'dist/core/native.js')
);
const { writePublishManifest } = require('./prepare-publish');

const target = nativeTarget(process.platform, process.arch, isMusl());
const platformDir = path.join(root, 'npm', target);
if (!fs.existsSync(platformDir)) {
  throw new Error(`no platform package for ${target}`);
}
const binding = path.join(root, 'native/orcher_core.node');
if (!fs.existsSync(binding)) {
  throw new Error(`${binding} is missing: run npm run build:native first`);
}

const dir = process.env.SMOKE_DIR
  ? path.resolve(process.env.SMOKE_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'orcher-sdk-smoke-'));
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

function run(cmd, args, cwd = dir) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
}

function pack(packageDir) {
  const [info] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', dir, packageDir]));
  return info;
}

const copied = path.join(platformDir, 'orcher_core.node');
const manifest = path.join(root, 'package.json');
const committedManifest = fs.readFileSync(manifest, 'utf8');
const { version } = JSON.parse(committedManifest);
fs.copyFileSync(binding, copied);
try {
  writePublishManifest();
  let sdk;
  try {
    sdk = pack(root);
  } finally {
    fs.writeFileSync(manifest, committedManifest);
  }
  const native = pack(platformDir);

  const files = sdk.files.map((f) => f.path);
  for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/testing/index.js', 'dist/testing/index.d.ts']) {
    if (!files.includes(required)) throw new Error(`${sdk.filename} lacks ${required}`);
  }
  const stray = files.filter((f) => f.endsWith('.node') || f.includes('__tests__'));
  if (stray.length > 0) throw new Error(`${sdk.filename} carries ${stray.join(', ')}`);
  if (!native.files.some((f) => f.path === 'orcher_core.node')) {
    throw new Error(`${native.filename} lacks orcher_core.node`);
  }
  console.log(`${sdk.filename}: ${files.length} files; ${native.filename}: ${native.files.length} files`);

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'orcher-sdk-smoke', version: '0.0.0', private: true }, null, 2)
  );
  // The other platform packages of this version need not be on npm yet (they
  // are published by the release this checks); npm skips optional
  // dependencies it cannot fetch.
  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    `./${native.filename}`,
    `./${sdk.filename}`,
    'typescript@5',
    '@types/node@20',
  ]);

  const installed = JSON.parse(
    fs.readFileSync(path.join(dir, 'node_modules/@orcher/sdk/package.json'), 'utf8')
  );
  // Every target in the loader, at exactly the SDK's version.
  const expected = Object.fromEntries(
    [...NATIVE_TARGETS].sort().map((t) => [`${NATIVE_PACKAGE_SCOPE}/sdk-${t}`, version])
  );
  if (JSON.stringify(installed.optionalDependencies) !== JSON.stringify(expected)) {
    throw new Error(
      `the packed SDK has optionalDependencies ${JSON.stringify(installed.optionalDependencies)}, ` +
        `not ${JSON.stringify(expected)}`
    );
  }
  console.log(`the packed SDK depends on ${Object.keys(expected).length} platform packages at ${version}`);

  fs.writeFileSync(
    path.join(dir, 'smoke.ts'),
    `import 'reflect-metadata';
import { getNativeModuleInfo, task, workflow, type TaskContext, type WorkflowContext } from '@orcher/sdk';
import { TestWorkflowEnvironment } from '@orcher/sdk/testing';

const greet = task({
  name: 'greet',
  execute: async (_ctx: TaskContext, name: string) => \`hello \${name}\`,
});

export const hello = workflow({
  name: 'hello',
  run: async (ctx: WorkflowContext, name: string) => ctx.executeTask(greet, name),
});

async function main(): Promise<void> {
  const info = getNativeModuleInfo();
  if (!info.available) throw new Error(\`native binding did not load: \${info.error}\`);
  const from = require.resolve('@orcher/sdk-${target}');
  console.log(\`native binding \${info.version} from \${from}\`);

  const env = await TestWorkflowEnvironment.create();
  env.mockTask('greet').returns('hello from a mock');
  const result = await env.executeWorkflow(
    (ctx: WorkflowContext, name: string) => ctx.executeTask(greet, name),
    'world'
  );
  await env.cleanup();
  if (result !== 'hello from a mock') throw new Error(\`unexpected result \${String(result)}\`);
  console.log(\`in-memory workflow returned: \${result}\`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`
  );
  const base = {
    target: 'ES2022',
    strict: true,
    esModuleInterop: true,
    // As `tsc --init` sets it. The testing entry's jest matcher declarations
    // do not check on their own (see the matcher name clash in the testing
    // assertions).
    skipLibCheck: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    types: ['node'],
    outDir: 'out',
  };
  for (const [name, options] of [
    ['tsconfig.node.json', { module: 'commonjs', moduleResolution: 'node' }],
    ['tsconfig.nodenext.json', { module: 'nodenext', moduleResolution: 'nodenext' }],
  ]) {
    fs.writeFileSync(
      path.join(dir, name),
      JSON.stringify({ compilerOptions: { ...base, ...options }, files: ['smoke.ts'] }, null, 2)
    );
    run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', name]);
  }

  // The nodenext build is the last one written to out/; it is CommonJS
  // because this project has no "type": "module".
  process.stdout.write(run(process.execPath, ['out/smoke.js']));

  fs.writeFileSync(
    path.join(dir, 'smoke.mjs'),
    `import { Worker, Client, workflow } from '@orcher/sdk';
import { TestWorkflowEnvironment } from '@orcher/sdk/testing';
for (const [name, value] of Object.entries({ Worker, Client, workflow, TestWorkflowEnvironment })) {
  if (typeof value !== 'function') throw new Error(name + ' did not import from ESM');
}
console.log('ESM import of both entry points: ok');
`
  );
  process.stdout.write(run(process.execPath, ['smoke.mjs']));
  console.log('smoke test passed');
} finally {
  fs.rmSync(copied, { force: true });
  if (!process.env.SMOKE_KEEP) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
