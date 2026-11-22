// Handshake authentication for socket connections: access-token extraction
// (handshake auth → Authorization header → cookie → JWT verify), token-expiry
// disconnect timers, and revocation-driven forced disconnects. Extracted from
// ChatGateway — must never import gateway.ts / service.ts (no cycles).
import { Logger } from "@nestjs/common";
import type { Socket } from "socket.io";
import { ACCESS_TOKEN_COOKIE_NAME } from "../auth/constants.js";
import type { JwtConfig } from "../auth/jwt.js";
import type { AuthRevocationListener } from "../auth/pg.js";
import type { AccessTokenPayload } from "../auth/types.js";

const logger = new Logger("ChatGateway");

const ACCESS_TOKEN_COOKIE_REGEX = new RegExp(`(?:^|;\\s*)${ACCESS_TOKEN_COOKIE_NAME}=([^;]+)`);

export class SocketAuthenticator {
  private readonly expiryTimers = new Map<Socket, ReturnType<typeof setTimeout>>();
  private readonly trackedSockets = new Map<Socket, () => void>();

  constructor(
    private readonly jwt: JwtConfig,
    private readonly revocations: AuthRevocationListener,
  ) {}

  /** Resolve and verify the access token from the socket handshake, if any. */
  async extractUserId(client: Socket): Promise<AccessTokenPayload | null> {
    const rawAuth = client.handshake.auth?.token as string | undefined;
    const rawHeader = client.handshake.headers?.authorization as string | undefined;
    const cookieHeader = client.handshake.headers?.cookie as string | undefined;

    let token: string | undefined;

    if (rawAuth && typeof rawAuth === "string") {
      token = rawAuth.trim();
    } else if (rawHeader && typeof rawHeader === "string" && rawHeader.startsWith("Bearer ")) {
      token = rawHeader.substring(7).trim();
    } else if (cookieHeader) {
      const match = cookieHeader.match(ACCESS_TOKEN_COOKIE_REGEX);
      if (match) {
        try {
          token = decodeURIComponent(match[1]);
        } catch {
          return null;
        }
      }
    }

    if (!token) {
      return null;
    }

    try {
      return await this.jwt.verifyAccessToken(token);
    } catch (err) {
      logger.warn(`Socket JWT verification failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Register a revocation-driven forced disconnect for the socket. Returns
   * false when the revocation listener is unavailable — the caller must reject
   * the connection.
   */
  trackRevocation(client: Socket, payload: AccessTokenPayload): boolean {
    const untrack = this.revocations.track(payload.sub, payload.sid, () => client.disconnect(true));
    if (!untrack) return false;
    this.trackedSockets.set(client, untrack);
    return true;
  }

  /** Force-disconnect the socket once its access token expires. */
  armTokenExpiry(client: Socket, expiresAtMs: number): void {
    const timer = setTimeout(() => client.disconnect(true), expiresAtMs - Date.now());
    timer.unref();
    this.expiryTimers.set(client, timer);
  }

  /** Drop the socket's revocation hook and expiry timer (idempotent). */
  untrack(client: Socket): void {
    this.trackedSockets.get(client)?.();
    this.trackedSockets.delete(client);
    const timer = this.expiryTimers.get(client);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(client);
  }

  /** Release every tracked socket and pending expiry timer. */
  shutdown(): void {
    for (const untrack of this.trackedSockets.values()) untrack();
    this.trackedSockets.clear();
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
  }
}
