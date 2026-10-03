import { createHash } from 'node:crypto';

function normalizeBytes(bytes) {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new TypeError('Artifact bytes must be an ArrayBuffer or typed array');
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(normalizeBytes(bytes)).digest('hex');
}

export function assertImmutableArtifactUrl(url) {
  const parsed = new URL(url);
  const mutablePath =
    parsed.pathname.includes('/releases/latest/') ||
    parsed.pathname.endsWith('/ffmpeg-release-essentials.zip');

  if (mutablePath) {
    throw new Error(`Mutable release artifact URL is not allowed: ${url}`);
  }

  return url;
}

export function verifyArtifactBuffer(bytes, { label, expectedSha256 }) {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256 ?? '')) {
    throw new Error(`Invalid trusted SHA-256 for ${label}`);
  }

  const actualSha256 = sha256Hex(bytes);
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `SHA-256 mismatch for ${label}: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }

  return actualSha256;
}
