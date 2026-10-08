/** Magic-byte checks so a renamed executable cannot pose as a screenshot. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
  'video/mp4': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'text/plain': (b) => !looksBinary(b),
  'application/json': (b) => !looksBinary(b),
};

function looksBinary(b: Buffer): boolean {
  return (
    b.includes(0) ||
    b.subarray(0, 2).toString('latin1') === 'MZ' ||
    b.subarray(1, 4).toString('latin1') === 'ELF'
  );
}

export function matchesDeclaredType(contentType: string, prefix: Buffer): boolean {
  return SIGNATURES[contentType]?.(prefix) ?? false;
}
