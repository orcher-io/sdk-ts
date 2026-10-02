/**
 * The release a worker declares, and how it is resolved.
 *
 * `versionId` is opaque to the server, which compares it for equality and binds
 * an execution to it on first claim. Two behaviors are worth pinning: it
 * defaults from the environment (the value normally comes from CI), and a blank
 * value means *not declared* rather than a release literally named "".
 */

import { WorkerBuilder } from '../worker-builder';

describe('versionId', () => {
  const original = process.env['ORCHER_VERSION_ID'];

  afterEach(() => {
    if (original === undefined) {
      delete process.env['ORCHER_VERSION_ID'];
    } else {
      process.env['ORCHER_VERSION_ID'] = original;
    }
  });

  it('is undeclared by default', () => {
    delete process.env['ORCHER_VERSION_ID'];
    const builder = WorkerBuilder.create();
    expect((builder as unknown as { options: { versionId?: string } }).options.versionId).toBeUndefined();
  });

  it('is carried through the builder when set explicitly', () => {
    const builder = WorkerBuilder.create().versionId('release-7');
    expect((builder as unknown as { options: { versionId?: string } }).options.versionId).toBe(
      'release-7'
    );
  });
});
