import { MESSAGE_MAX_BODY_LENGTH } from "./constants.js";

/**
 * Counts Unicode code points rather than UTF-16 code units.
 *
 * This matches PostgreSQL `char_length` for the message-body contract, so a
 * supplementary-plane character such as 😀 is counted once in every layer.
 * Grapheme clusters are intentionally not collapsed: the database constraint
 * and API contract are defined in code points, not rendered glyphs.
 */
export function countMessageBodyCodePoints(value: string): number {
  return Array.from(value).length;
}

export function isMessageBodyWithinLimit(value: string): boolean {
  return countMessageBodyCodePoints(value) <= MESSAGE_MAX_BODY_LENGTH;
}
