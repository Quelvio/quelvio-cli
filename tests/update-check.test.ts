import { describe, expect, it } from 'vitest';
import { isNewer, isUpdateCheckDisabled } from '../src/update-check.js';

describe('update-check helpers', () => {
  it('isNewer compares semver triplets', () => {
    expect(isNewer('0.3.1', '0.3.0')).toBe(true);
    expect(isNewer('0.4.0', '0.3.99')).toBe(true);
    expect(isNewer('1.0.0', '0.99.0')).toBe(true);
    expect(isNewer('0.3.0', '0.3.0')).toBe(false);
    expect(isNewer('0.2.9', '0.3.0')).toBe(false);
  });

  it('isNewer treats malformed versions as not newer', () => {
    expect(isNewer('not-a-version', '0.3.0')).toBe(false);
    expect(isNewer('0.3.0', 'banana')).toBe(false);
  });

  it('isNewer ignores pre-release suffixes (compares numeric core only)', () => {
    expect(isNewer('0.3.1-beta.1', '0.3.0')).toBe(true);
    expect(isNewer('0.3.0-rc.1', '0.3.0')).toBe(false);
  });

  it('isUpdateCheckDisabled honors "off", "0", "false" (any case)', () => {
    expect(isUpdateCheckDisabled({ QUELVIO_UPDATE_CHECK: 'off' })).toBe(true);
    expect(isUpdateCheckDisabled({ QUELVIO_UPDATE_CHECK: 'OFF' })).toBe(true);
    expect(isUpdateCheckDisabled({ QUELVIO_UPDATE_CHECK: '0' })).toBe(true);
    expect(isUpdateCheckDisabled({ QUELVIO_UPDATE_CHECK: 'false' })).toBe(true);
    expect(isUpdateCheckDisabled({ QUELVIO_UPDATE_CHECK: '' })).toBe(false);
    expect(isUpdateCheckDisabled({})).toBe(false);
    expect(isUpdateCheckDisabled({ QUELVIO_UPDATE_CHECK: 'on' })).toBe(false);
  });
});
