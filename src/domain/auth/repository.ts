export const AUTH_SESSION_REPOSITORY = Symbol("AUTH_SESSION_REPOSITORY");

export interface AuthSessionRepository {
  create(userId: string, sessionId: string, expiresAt: Date): Promise<void>;
  isActive(userId: string, sessionId: string): Promise<boolean>;
  extend(userId: string, sessionId: string, expiresAt: Date): Promise<boolean>;
  revoke(userId: string, sessionId: string): Promise<void>;
  revokeAll(userId: string): Promise<void>;
  purgeExpired(limit: number): Promise<number>;
}
