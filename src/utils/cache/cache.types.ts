// Result + parameter types for atomic cache ops (session/OTP).
// Named-field interfaces instead of positional args so key order cannot be
// mixed up at call sites. Ported from Rust `dsa/src/utils/cache/types.rs`.

export enum RotationOutcome {
  /** Old key was valid and rotation finished (old deleted, new + sessions written). */
  Rotated = "Rotated",
  /** Old key missing or subject mismatch — possible replay, caller must revoke the family. */
  Stale = "Stale",
}

export enum OtpCheckOutcome {
  /** Code matches (entry untouched, not consumed). */
  Match = "Match",
  /** Wrong code but attempts remain. */
  Mismatch = "Mismatch",
  /** Entry missing, expired or corrupt (corrupt entries are deleted). */
  Missing = "Missing",
  /** Attempt limit just exceeded — entry deleted, request a new code. */
  Locked = "Locked",
}

export interface RefreshRotation {
  oldKey: string;
  newKey: string;
  sessionKey: string;
  subject: string;
  oldJti: string;
  newJti: string;
  ttlSecs: number;
}

export interface NewRefreshSession {
  key: string;
  sessionKey: string;
  subject: string;
  jti: string;
  ttlSecs: number;
  maxSessions: number;
}

export interface RevokeRefreshSession {
  key: string;
  sessionKey: string;
  jti: string;
  ttlSecs: number;
}

export interface OtpEntry {
  code: string;
  attempts: number;
}
