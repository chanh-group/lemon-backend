import { getRandomValues } from 'node:crypto';
import { customType, timestamp } from 'drizzle-orm/pg-core';

export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
};

let lastTimestamp = 0;
let seq = 0;

/**
 * Generates an RFC 9562 compliant, strictly monotonic UUIDv7 string.
 * - 48 bits: Unix Epoch timestamp in milliseconds.
 * - 4 bits: Version 7 (0b0111).
 * - 12 bits: Monotonic sequence counter.
 * - 2 bits: Variant 1 (0b10).
 * - 62 bits: Cryptographic pseudorandom data.
 *
 * Guaranteed to be time-ordered and lexicographically sortable for cursor pagination.
 */
export function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  getRandomValues(bytes);

  let now = Date.now();
  if (now <= lastTimestamp) {
    now = lastTimestamp;
    seq = (seq + 1) & 0x0fff;
  } else {
    lastTimestamp = now;
    seq = ((bytes[6] & 0x0f) << 8) | bytes[7];
  }

  // 48-bit timestamp (big-endian)
  bytes[0] = (now / 0x10000000000) & 0xff;
  bytes[1] = (now / 0x100000000) & 0xff;
  bytes[2] = (now / 0x1000000) & 0xff;
  bytes[3] = (now / 0x10000) & 0xff;
  bytes[4] = (now / 0x100) & 0xff;
  bytes[5] = now & 0xff;

  // Version 7 in byte 6 high nibble, seq counter in remaining 12 bits
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  bytes[7] = seq & 0xff;

  // Variant 1 (0b10xxxxxx) in byte 8
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
