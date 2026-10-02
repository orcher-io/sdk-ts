#!/usr/bin/env node
/**
 * Lay out @orcher/sdk and its platform packages for `npm publish`.
 *
 * The platform packages live in `npm/<target>/`, one per prebuilt binding,
 * with their package.json committed. Their versions move in lockstep with the
 * SDK version (release-please bumps all of them; see
 * release-please-config.json).
 *
 * The SDK depends on them only once published: its committed package.json
 * has no optionalDependencies, and this script adds one per target in
 * `NATIVE_TARGETS`, pinned to the SDK's version. Committing the pins instead
 * would put packages in package.json that are not on npm until the release
 * that publishes them, and npm 11 refuses `npm ci` when package.json names a
 * dependency the lockfile cannot contain.
 *
 * This script:
 *
 * - checks that every target has a platform package carrying the SDK's
 *   version;
 * - copies each binding from `<bindings>/<target>/orcher_core.node` (where
 *   the release workflow downloads its build artifacts) into its package,
 *   together with the LICENSE;
 * - writes the platform packages into the SDK's package.json as
 *   optionalDependencies;
 * - writes the repository README into the SDK package, with its relative
 *   links made absolute so they work on npmjs.com.
 *
 * Needs `npm run build:ts` first: the targets come from the built loader.
 *
 * Usage: node scripts/prepare-publish.js [--check] [<bindings dir>]
 *   --check  only check versions and that every binding is present
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '../..');

/**
 * The optionalDependencies @orcher/sdk is published with: every platform
 * package, pinned to exactly `version`.
 */
function platformDependencies(version, targets, scope) {
  return Object.fromEntries([...targets].sort().map((t) => [`${scope}/sdk-${t}`, version]));
}

/**
 * The SDK's package.json as published: `pkg` with the platform packages as
 * optionalDependencies, placed after its dependencies.
 */
function publishManifest(pkg, targets, scope) {
  const out = {};
  for (const [key, value] of Object.entries(pkg)) {
    if (key === 'optionalDependencies') continue;
    out[key] = value;
    if (key === 'dependencies') {
      out.optionalDependencies = platformDependencies(pkg.version, targets, scope);
    }
  }
  if (!out.optionalDependencies) {
    out.optionalDependencies = platformDependencies(pkg.version, targets, scope);
  }
  return out;
}

/** The targets and package scope, from the built loader (dist/core/native.js). */
function loadTargets() {
  const built = path.join(root, 'dist/core/native.js');
  if (!fs.existsSync(built)) {
    throw new Error(`${built} is missing: run npm run build:ts first`);
  }
  const { NATIVE_TARGETS, NATIVE_PACKAGE_SCOPE } = require(built);
  return { targets: NATIVE_TARGETS, scope: NATIVE_PACKAGE_SCOPE };
}

/** Rewrite the SDK's package.json in place as it is published. */
function writePublishManifest() {
  const file = path.join(root, 'package.json');
  const { targets, scope } = loadTargets();
  const pkg = publishManifest(JSON.parse(fs.readFileSync(file, 'utf8')), targets, scope);
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const bindings = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'bindings'));

  const sdk = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { targets, scope } = loadTargets();
  const problems = [];

  const dirs = fs.readdirSync(path.join(root, 'npm')).sort();
  if (JSON.stringify(dirs) !== JSON.stringify([...targets].sort())) {
    problems.push(`npm/ holds ${dirs.join(', ')}; NATIVE_TARGETS is ${[...targets].sort().join(', ')}`);
  }

  for (const target of targets) {
    const dir = path.join(root, 'npm', target);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pkg.name !== `${scope}/sdk-${target}`) {
      problems.push(`npm/${target} is named ${pkg.name}`);
    }
    if (pkg.version !== sdk.version) {
      problems.push(`${pkg.name} is ${pkg.version}, the SDK is ${sdk.version}`);
    }
    const binding = path.join(bindings, target, 'orcher_core.node');
    if (!fs.existsSync(binding)) {
      problems.push(`no binding for ${target} at ${binding}`);
      continue;
    }
    if (!check) {
      fs.copyFileSync(binding, path.join(dir, 'orcher_core.node'));
      fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(dir, 'LICENSE'));
      console.log(`prepared ${pkg.name}@${pkg.version}`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exit(1);
  }

  if (!check) {
    const published = writePublishManifest();
    for (const [name, version] of Object.entries(published.optionalDependencies)) {
      console.log(`${sdk.name} depends on ${name}@${version}`);
    }

    // npm shows the package's own README, and resolves relative links against
    // neither the repository root nor this package, so point them at GitHub.
    const blob = 'https://github.com/orcher-io/sdk-ts/blob/main/';
    const raw = 'https://raw.githubusercontent.com/orcher-io/sdk-ts/main/';
    const readme = fs
      .readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
      .replace(/(src|srcset)="\.\/(?!\/)/g, `$1="${raw}`)
      .replace(/\]\(\.?\/?(?!https?:|#)([^)]+)\)/g, `](${blob}$1)`)
      .replace(/href="\.\/(?!\/)/g, `href="${blob}`);
    fs.writeFileSync(path.join(root, 'README.md'), readme);
    console.log('wrote README.md');
  }
  console.log(check ? 'all bindings present' : `ready to publish ${sdk.name}@${sdk.version}`);
}

module.exports = { platformDependencies, publishManifest, writePublishManifest };

if (require.main === module) {
  main();
}
