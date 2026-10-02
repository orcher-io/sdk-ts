#!/usr/bin/env node
/**
 * Lay out @orcher/sdk and its platform packages for `npm publish`.
 *
 * The platform packages live in `npm/<target>/`, one per prebuilt binding,
 * with their package.json committed. Their versions, and the SDK's
 * optionalDependencies pins on them, move in lockstep with the SDK version
 * (release-please bumps all of them; see release-please-config.json). This
 * script:
 *
 * - checks that every platform package and pin carries the SDK's version;
 * - copies each binding from `<bindings>/<target>/orcher_core.node` (where
 *   the release workflow downloads its build artifacts) into its package,
 *   together with the LICENSE;
 * - writes the repository README into the SDK package, with its relative
 *   links made absolute so they work on npmjs.com.
 *
 * Usage: node scripts/prepare-publish.js [--check] [<bindings dir>]
 *   --check  only check versions and that every binding is present
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '../..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const bindings = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'bindings'));

const main = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const targets = fs.readdirSync(path.join(root, 'npm')).sort();
const problems = [];

const pins = main.optionalDependencies || {};
const expectedPins = targets.map((t) => `@orcher/sdk-${t}`).sort();
if (JSON.stringify(Object.keys(pins).sort()) !== JSON.stringify(expectedPins)) {
  problems.push(`optionalDependencies must be exactly ${expectedPins.join(', ')}`);
}

for (const target of targets) {
  const dir = path.join(root, 'npm', target);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (pkg.version !== main.version) {
    problems.push(`${pkg.name} is ${pkg.version}, the SDK is ${main.version}`);
  }
  if (pins[pkg.name] !== main.version) {
    problems.push(`the SDK pins ${pkg.name} to ${pins[pkg.name]}, not ${main.version}`);
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
console.log(check ? 'all bindings present' : `ready to publish ${main.name}@${main.version}`);
