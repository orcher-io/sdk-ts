import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  NATIVE_PACKAGE_SCOPE,
  NATIVE_TARGETS,
  nativePackageName,
  nativeTarget,
  isMusl,
} from '../native';

const packageRoot = join(__dirname, '../../..');

// The script that lays out the packages for npm; it adds the platform
// packages to the SDK's package.json at publish time.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { publishManifest } = require(join(packageRoot, 'scripts/prepare-publish.js')) as {
  publishManifest: (
    pkg: Record<string, any>,
    targets: readonly string[],
    scope: string
  ) => Record<string, any>;
};

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
}

describe('nativePackageName', () => {
  it('names the platform package for each published target', () => {
    expect(nativePackageName('darwin', 'arm64', false)).toBe('@orcher/sdk-darwin-arm64');
    expect(nativePackageName('darwin', 'x64', false)).toBe('@orcher/sdk-darwin-x64');
    expect(nativePackageName('linux', 'x64', false)).toBe('@orcher/sdk-linux-x64-gnu');
    expect(nativePackageName('linux', 'arm64', false)).toBe('@orcher/sdk-linux-arm64-gnu');
    expect(nativePackageName('linux', 'x64', true)).toBe('@orcher/sdk-linux-x64-musl');
    expect(nativePackageName('linux', 'arm64', true)).toBe('@orcher/sdk-linux-arm64-musl');
  });

  it('is null where nothing is published', () => {
    expect(nativePackageName('win32', 'x64', false)).toBeNull();
    expect(nativePackageName('linux', 'riscv64', false)).toBeNull();
    expect(nativePackageName('freebsd', 'x64', false)).toBeNull();
  });

  it('ignores libc outside linux', () => {
    // musl is a linux question; passing true elsewhere must not invent a target
    expect(nativeTarget('darwin', 'arm64', true)).toBe('darwin-arm64');
    expect(nativePackageName('darwin', 'arm64', true)).toBe('@orcher/sdk-darwin-arm64');
  });
});

describe('platform packages', () => {
  const main = readJson(join(packageRoot, 'package.json'));
  const dirs = readdirSync(join(packageRoot, 'npm')).sort();

  it('has one package directory per published target', () => {
    expect(dirs).toEqual([...NATIVE_TARGETS].sort());
  });

  it('leaves the platform packages out of the committed package.json', () => {
    // They are not on npm until the release that publishes them, and npm 11
    // refuses `npm ci` when package.json names a dependency the lockfile
    // cannot contain.
    expect(main['optionalDependencies']).toBeUndefined();
  });

  it('publishes every platform package as an optional dependency pinned to the SDK version', () => {
    const published = publishManifest(main, NATIVE_TARGETS, NATIVE_PACKAGE_SCOPE);
    const expected = Object.fromEntries(
      [...NATIVE_TARGETS].sort().map((t) => [`@orcher/sdk-${t}`, main['version']])
    );
    expect(published['optionalDependencies']).toEqual(expected);
    expect(Object.keys(expected).map((name) => name.slice('@orcher/sdk-'.length))).toEqual(dirs);
    // Nothing else changes.
    const { optionalDependencies: _added, ...rest } = published;
    expect(rest).toEqual(main);
  });

  it.each(NATIVE_TARGETS)('%s matches the SDK version and declares where it runs', (target) => {
    const pkg = readJson(join(packageRoot, 'npm', target, 'package.json'));
    expect(pkg['name']).toBe(`@orcher/sdk-${target}`);
    expect(pkg['version']).toBe(main['version']);
    expect(pkg['license']).toBe('Apache-2.0');
    expect(pkg['main']).toBe('orcher_core.node');
    expect(pkg['repository']['directory']).toBe(`packages/sdk/npm/${target}`);
    expect(pkg['publishConfig']).toEqual({ access: 'public', provenance: true });

    const [os, cpu, libc] = target.split('-');
    expect(pkg['os']).toEqual([os]);
    expect(pkg['cpu']).toEqual([cpu]);
    if (os === 'linux') {
      expect(pkg['libc']).toEqual([libc === 'musl' ? 'musl' : 'glibc']);
    } else {
      expect(pkg['libc']).toBeUndefined();
    }
  });
});

describe('isMusl', () => {
  it('answers for the machine the tests run on without throwing', () => {
    const answer = isMusl();
    expect(typeof answer).toBe('boolean');
    if (process.platform !== 'linux') {
      expect(answer).toBe(false);
    }
  });
});
