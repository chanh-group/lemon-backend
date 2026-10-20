// Production Redis backend — every session/OTP op runs as one Lua script
// (single round trip, atomic). Scripts are ported verbatim from Rust
// `dsa/src/utils/cache/redis.rs` (`cjson` ships with Redis Lua).
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Redis } from "ioredis";
import { RedisHealthService } from "../../configs/redis-health.js";
import { RedisMetricsService, type RedisMetricOperation } from "../../configs/redis-metrics.js";
import { REFRESH_TOKEN_KEY_PREFIX } from "./constants.js";
import { CacheError } from "./error.js";
import { CacheStoreExt, REDIS_CLIENT } from "./store.js";
import {
  OtpCheckOutcome,
  RotationOutcome,
  type NewRefreshSession,
  type RefreshRotation,
  type RevokeRefreshSession,
} from "./types.js";

export const ROTATE_REFRESH_COMMAND = "rotateRefresh";
export const CREATE_SESSION_COMMAND = "createSession";
export const REVOKE_SESSION_COMMAND = "revokeSession";
export const CHECK_OTP_COMMAND = "checkOtp";
export const RELEASE_LOCK_COMMAND = "releaseLock";

/** Rotate refresh + update sessions JSON in 1 round trip. Returns 1 rotated, 0 stale. */
export const ROTATE_REFRESH_LUA = `
  local cur = redis.call('GET', KEYS[1])
  if not cur or cur ~= ARGV[1] then
      return 0
  end
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[4])
  local raw = redis.call('GET', KEYS[3])
  local sessions = {}
  if raw then
      local ok, decoded = pcall(cjson.decode, raw)
      if ok and type(decoded) == 'table' then
          sessions = decoded
      end
  end
  local updated = {}
  for _, v in ipairs(sessions) do
      if v ~= ARGV[2] then
          updated[#updated + 1] = v
      end
  end
  updated[#updated + 1] = ARGV[3]
  redis.call('SET', KEYS[3], cjson.encode(updated), 'EX', ARGV[4])
  return 1
`;

/** Create a session + evict the oldest past max in 1 round trip. Returns session count. */
export const CREATE_SESSION_LUA = `
  local raw = redis.call('GET', KEYS[2])
  local sessions = {}
  if raw then
      local ok, decoded = pcall(cjson.decode, raw)
      if ok and type(decoded) == 'table' then
          sessions = decoded
      end
  end
  sessions[#sessions + 1] = ARGV[2]
  local max_n = tonumber(ARGV[4])
  while #sessions > max_n do
      local evicted = table.remove(sessions, 1)
      redis.call('DEL', ARGV[5] .. evicted)
  end
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
  redis.call('SET', KEYS[2], cjson.encode(sessions), 'EX', ARGV[3])
  return #sessions
`;

/** Revoke one session (single sign-out), keeping the sessions list's remaining TTL. */
export const REVOKE_SESSION_LUA = `
  redis.call('DEL', KEYS[1])
  local raw = redis.call('GET', KEYS[2])
  if not raw then
      return 0
  end
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= 'table' then
      redis.call('DEL', KEYS[2])
      return 0
  end
  local updated = {}
  for _, v in ipairs(decoded) do
      if v ~= ARGV[1] then
          updated[#updated + 1] = v
      end
  end
  if #updated == 0 then
      redis.call('DEL', KEYS[2])
  else
      redis.call('SET', KEYS[2], cjson.encode(updated), 'KEEPTTL')
  end
  return 1
`;

/**
 * OTP check: wrong attempts bump the counter but `KEEPTTL` (no TTL sliding).
 * Returns `1` match, `0` mismatch with attempts left, `-1` missing/corrupt,
 * `-2` just exceeded the limit (deleted).
 */
export const CHECK_OTP_LUA = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then
      return -1
  end
  local ok, entry = pcall(cjson.decode, raw)
  if not ok or type(entry) ~= 'table' then
      redis.call('DEL', KEYS[1])
      return -1
  end
  if entry.code == ARGV[1] then
      return 1
  end
  local attempts = tonumber(entry.attempts) or 0
  attempts = attempts + 1
  if attempts >= tonumber(ARGV[2]) then
      redis.call('DEL', KEYS[1])
      return -2
  end
  entry.attempts = attempts
  redis.call('SET', KEYS[1], cjson.encode(entry), 'KEEPTTL')
  return 0
`;

/** Compare-and-del: release only if we still own the lock (stale release = 0). */
export const RELEASE_LOCK_LUA = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
  else
      return 0
  end
`;

/**
 * Register the five cache Lua scripts on a client. Exported so the module and
 * tests share the exact registration (names + scripts).
 */
export function registerCacheCommands(client: Pick<Redis, "defineCommand">): void {
  client.defineCommand(ROTATE_REFRESH_COMMAND, { lua: ROTATE_REFRESH_LUA });
  client.defineCommand(CREATE_SESSION_COMMAND, { lua: CREATE_SESSION_LUA });
  client.defineCommand(REVOKE_SESSION_COMMAND, { lua: REVOKE_SESSION_LUA });
  client.defineCommand(CHECK_OTP_COMMAND, { lua: CHECK_OTP_LUA });
  client.defineCommand(RELEASE_LOCK_COMMAND, { lua: RELEASE_LOCK_LUA });
}

export interface RedisWithCacheCommands extends Redis {
  rotateRefresh(
    numKeys: 3,
    oldKey: string,
    newKey: string,
    sessionKey: string,
    subject: string,
    oldJti: string,
    newJti: string,
    ttlSecs: number,
  ): Promise<number>;
  createSession(
    numKeys: 2,
    key: string,
    sessionKey: string,
    subject: string,
    jti: string,
    ttlSecs: number,
    maxSessions: number,
    refreshPrefix: string,
  ): Promise<number>;
  revokeSession(numKeys: 2, key: string, sessionKey: string, jti: string): Promise<number>;
  checkOtp(numKeys: 1, key: string, candidate: string, maxAttempts: number): Promise<number>;
  releaseLock(numKeys: 1, key: string, token: string): Promise<number>;
}

@Injectable()
export class RedisCacheService extends CacheStoreExt {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisWithCacheCommands,
    @Optional() @Inject(RedisHealthService) private readonly health?: RedisHealthService,
    @Optional() @Inject(RedisMetricsService) private readonly metrics?: RedisMetricsService,
  ) {
    super();
  }

  private execute<T>(operation: RedisMetricOperation, action: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      try {
        return await action();
      } catch (err) {
        this.health?.markUnavailable(err);
        throw err;
      }
    };
    return this.metrics ? this.metrics.measure(operation, run) : run();
  }

  async getRaw(key: string): Promise<string | null> {
    try {
      return await this.execute("cache_get", () => this.redis.get(key));
    } catch (err) {
      this.logger.warn(`Redis GET failed: ${String(err)}`);
      throw new CacheError("GET", err);
    }
  }

  async setRaw(key: string, value: string, expirationSecs: number): Promise<void> {
    try {
      await this.execute("cache_set", () => this.redis.set(key, value, "EX", expirationSecs));
    } catch (err) {
      this.logger.warn(`Redis SETEX failed: ${String(err)}`);
      throw new CacheError("SETEX", err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.execute("cache_delete", () => this.redis.del(key));
    } catch (err) {
      this.logger.warn(`Redis DEL failed: ${String(err)}`);
      throw new CacheError("DEL", err);
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.execute("cache_delete_many", async () => {
        const results = await this.redis.pipeline(keys.map((key) => ["del", key])).exec();
        if (!results || results.length !== keys.length || results.some(([err]) => err)) {
          throw new Error("Redis pipelined DEL returned a failed result");
        }
      });
    } catch (err) {
      this.logger.warn(`Redis pipelined DEL failed: ${String(err)}`);
      throw new CacheError("pipelined DEL", err);
    }
  }

  async rotateRefreshToken(rotation: RefreshRotation): Promise<RotationOutcome> {
    try {
      const rotated = await this.execute("cache_rotate_refresh", () =>
        this.redis.rotateRefresh(
          3,
          rotation.oldKey,
          rotation.newKey,
          rotation.sessionKey,
          rotation.subject,
          rotation.oldJti,
          rotation.newJti,
          rotation.ttlSecs,
        ),
      );
      return rotated === 1 ? RotationOutcome.Rotated : RotationOutcome.Stale;
    } catch (err) {
      this.logger.warn(`Redis refresh rotation failed: ${String(err)}`);
      throw new CacheError("refresh rotation", err);
    }
  }

  async createRefreshSession(session: NewRefreshSession): Promise<void> {
    try {
      await this.execute("cache_create_session", () =>
        this.redis.createSession(
          2,
          session.key,
          session.sessionKey,
          session.subject,
          session.jti,
          session.ttlSecs,
          session.maxSessions,
          REFRESH_TOKEN_KEY_PREFIX,
        ),
      );
    } catch (err) {
      this.logger.warn(`Redis session creation failed: ${String(err)}`);
      throw new CacheError("session creation", err);
    }
  }

  async revokeRefreshSession(revoke: RevokeRefreshSession): Promise<void> {
    try {
      await this.execute("cache_revoke_session", () =>
        this.redis.revokeSession(2, revoke.key, revoke.sessionKey, revoke.jti),
      );
    } catch (err) {
      this.logger.warn(`Redis session revocation failed: ${String(err)}`);
      throw new CacheError("session revocation", err);
    }
  }

  async checkOtpCode(
    key: string,
    candidate: string,
    maxAttempts: number,
  ): Promise<OtpCheckOutcome> {
    try {
      const verdict = await this.execute("cache_check_otp", () =>
        this.redis.checkOtp(1, key, candidate, maxAttempts),
      );
      switch (verdict) {
        case 1:
          return OtpCheckOutcome.Match;
        case 0:
          return OtpCheckOutcome.Mismatch;
        case -2:
          return OtpCheckOutcome.Locked;
        default:
          return OtpCheckOutcome.Missing;
      }
    } catch (err) {
      this.logger.warn(`Redis OTP check failed: ${String(err)}`);
      throw new CacheError("OTP check", err);
    }
  }

  async tryAcquireLock(key: string, token: string, expirationSecs: number): Promise<boolean> {
    try {
      return (
        (await this.execute("cache_lock", () =>
          this.redis.set(key, token, "EX", expirationSecs, "NX"),
        )) === "OK"
      );
    } catch (err) {
      this.logger.warn(`Redis lock acquire failed: ${String(err)}`);
      throw new CacheError("lock acquire", err);
    }
  }

  async releaseLock(key: string, token: string): Promise<void> {
    try {
      await this.execute("cache_unlock", () => this.redis.releaseLock(1, key, token));
    } catch (err) {
      this.logger.warn(`Redis lock release failed: ${String(err)}`);
      throw new CacheError("lock release", err);
    }
  }
}
