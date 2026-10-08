import { describe, expect, it } from 'vitest';
import { matchesDeclaredType } from './file-signature.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('matchesDeclaredType', () => {
  it('accepts genuine files', () => {
    expect(matchesDeclaredType('image/png', PNG)).toBe(true);
    expect(matchesDeclaredType('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesDeclaredType('text/plain', Buffer.from('round 1: 13-11'))).toBe(true);
  });

  it('rejects mismatched or executable content', () => {
    expect(matchesDeclaredType('image/png', Buffer.from('MZ\x90\x00 this is a PE file'))).toBe(
      false,
    );
    expect(matchesDeclaredType('text/plain', Buffer.from('MZ\x90\x00'))).toBe(false);
    expect(matchesDeclaredType('application/x-msdownload', PNG)).toBe(false);
  });
});
