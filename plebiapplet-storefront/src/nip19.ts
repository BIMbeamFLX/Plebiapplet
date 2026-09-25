/**
 * Bundled NIP-19 bech32 encoding.
 *
 * Used as the fallback when the optional `common` domain is absent (SPEC 5:
 * "NIP-19 encode done with bundled code"). Encode only — the napplet never
 * decodes user-supplied bech32 and never touches `nsec`.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) checksum ^= GENERATOR[i];
    }
  }
  return checksum;
}

function expandHrp(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (const char of hrp) {
    high.push(char.charCodeAt(0) >> 5);
    low.push(char.charCodeAt(0) & 31);
  }
  return [...high, 0, ...low];
}

function convertBits(data: number[], from: number, to: number): number[] | null {
  let accumulator = 0;
  let bits = 0;
  const out: number[] = [];
  const maxValue = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    accumulator = (accumulator << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((accumulator >> bits) & maxValue);
    }
  }
  if (bits > 0) out.push((accumulator << (to - bits)) & maxValue);
  return out;
}

function bech32Encode(hrp: string, words: number[]): string {
  const checksumInput = [...expandHrp(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(checksumInput) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i += 1) checksum.push((mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join('')}`;
}

function hexToBytes(hex: string): number[] | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

/** Encode a 32-byte hex pubkey as `npub1…`, or null when the input is malformed. */
export function encodeNpub(pubkeyHex: string): string | null {
  const bytes = hexToBytes(pubkeyHex);
  if (!bytes || bytes.length !== 32) return null;
  const words = convertBits(bytes, 8, 5);
  return words ? bech32Encode('npub', words) : null;
}

function tlv(type: number, value: number[]): number[] {
  return [type, value.length, ...value];
}

/** Encode an addressable coordinate as `naddr1…`, or null when the input is malformed. */
export function encodeNaddr(kind: number, pubkeyHex: string, identifier: string): string | null {
  const pubkey = hexToBytes(pubkeyHex);
  if (!pubkey || pubkey.length !== 32) return null;
  const identifierBytes = [...new TextEncoder().encode(identifier)];
  const kindBytes = [
    (kind >> 24) & 0xff,
    (kind >> 16) & 0xff,
    (kind >> 8) & 0xff,
    kind & 0xff,
  ];
  const payload = [...tlv(0, identifierBytes), ...tlv(2, pubkey), ...tlv(3, kindBytes)];
  const words = convertBits(payload, 8, 5);
  return words ? bech32Encode('naddr', words) : null;
}

/** Shorten a hex pubkey or bech32 string for compact display. */
export function truncateId(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
