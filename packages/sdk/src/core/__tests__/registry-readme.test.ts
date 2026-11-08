import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { registryReadme } = require(join(repoRoot, 'packages/sdk/scripts/prepare-publish.js')) as {
  registryReadme: (markdown: string) => string;
};

describe('registryReadme', () => {
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

  it("gives npm the repository README's banner as one <picture>", () => {
    const npm = registryReadme(readme);
    expect(npm).not.toMatch(/#gh-(dark|light)-mode-only/);
    expect(npm.match(/<picture>/g)).toHaveLength(1);
    expect(npm).toContain(
      '<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/orcher-io/sdk-ts/main/assets/banner.svg">',
    );
    expect(npm).toContain(
      '<source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/orcher-io/sdk-ts/main/assets/banner-light.svg">',
    );
  });

  it('leaves the rest of the README as it is', () => {
    const afterBanner = (text: string) => text.slice(text.indexOf('<p align="center">'));
    expect(afterBanner(registryReadme(readme))).toBe(afterBanner(readme));
  });

  it('refuses a README without the banner block', () => {
    expect(() => registryReadme('# Title\n')).toThrow('no <!-- banner --> block');
  });
});
