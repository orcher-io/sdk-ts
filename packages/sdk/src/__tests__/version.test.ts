/**
 * The exported VERSION is the version of the package that is installed.
 */

import { VERSION } from '../index';

describe('VERSION', () => {
  it('is the package version', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { version } = require('../../package.json') as { version: string };
    expect(VERSION).toBe(version);
  });
});
