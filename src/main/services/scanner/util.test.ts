// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { nameFromExe, productNameFromDir } from './util';

describe('productNameFromDir', () => {
  it('walks up past a version-number subfolder to the product folder', () => {
    expect(productNameFromDir('C:\\Program Files\\Quark\\7.1.7.975')).toBe('Quark');
  });

  it('walks up past an `app-<version>` subfolder (Slack layout)', () => {
    expect(productNameFromDir('C:\\Users\\me\\AppData\\Local\\slack\\app-4.0.0')).toBe('slack');
  });

  it('walks up past a hex build-hash subfolder (VS Code layout)', () => {
    expect(productNameFromDir('C:\\Users\\me\\AppData\\Local\\Microsoft VS Code\\a5b5009513')).toBe(
      'Microsoft VS Code',
    );
  });

  it('returns the folder itself when it is already the product name', () => {
    expect(productNameFromDir('C:\\Program Files\\CoolApp')).toBe('CoolApp');
  });

  it('handles vendor + version nesting (Soda Music)', () => {
    expect(productNameFromDir('C:\\Users\\me\\AppData\\Local\\Programs\\Soda Music\\3.7.0')).toBe(
      'Soda Music',
    );
  });

  it('handles forward-slash paths', () => {
    expect(productNameFromDir('/opt/quark/7.1.7')).toBe('quark');
  });

  it('returns an empty string when every ancestor is a version/hash segment', () => {
    // Each level is version-like; the drive root has no name.
    expect(productNameFromDir('C:\\1.0\\2.0\\3.0\\4.0')).toBe('');
  });
});

describe('nameFromExe', () => {
  it('strips the extension', () => {
    expect(nameFromExe('C:\\Apps\\myapp\\myapp.exe')).toBe('myapp');
  });
});
