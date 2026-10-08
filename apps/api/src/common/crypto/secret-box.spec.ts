import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  it('round-trips and rejects tampering', () => {
    const box = new SecretBox('k'.repeat(32));
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
  });

  it('cannot be opened with another key', () => {
    const sealed = new SecretBox('a'.repeat(32)).seal('secret');
    expect(() => new SecretBox('b'.repeat(32)).open(sealed)).toThrow();
  });
});
