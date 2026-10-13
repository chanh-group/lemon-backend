import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DrizzleDb } from '../../../src/configs/database.module.js';
import * as schema from '../../../src/configs/schema.js';

describe('Drizzle SQL Query Builder Verification', () => {
  let db: DrizzleDb;

  beforeAll(() => {
    const pool = new Pool();
    db = drizzle(pool, { schema });
  });

  describe('User Queries', () => {
    it('should generate valid INSERT user SQL', () => {
      const query = db
        .insert(schema.users)
        .values({
          id: '0193a2b1-0000-7000-8000-000000000001',
          email: 'test@example.com',
          username: 'test_user',
          fullName: 'Test User',
          passwordHash: 'argon2id_hash',
        })
        .toSQL();

      expect(query.sql).toContain('insert into "users"');
      expect(query.sql).toContain('"email"');
      expect(query.sql).toContain('"username"');
      expect(query.params).toContain('test@example.com');
      expect(query.params).toContain('test_user');
    });

    it('should generate valid active user lookup with soft delete condition', () => {
      const query = db
        .select()
        .from(schema.users)
        .where(
          and(
            eq(schema.users.username, 'test_user'),
            isNull(schema.users.deletedAt),
          ),
        )
        .toSQL();

      expect(query.sql).toContain('select');
      expect(query.sql).toContain('from "users"');
      expect(query.sql).toContain('where');
      expect(query.sql).toContain('"users"."username" = $1');
      expect(query.sql).toContain('"users"."deleted_at" is null');
      expect(query.params).toEqual(['test_user']);
    });
  });

  describe('Friendship Queries', () => {
    it('should generate pair search query for friendships', () => {
      const targetUserId = '0193a2b1-0000-7000-8000-000000000001';
      const query = db
        .select()
        .from(schema.friendships)
        .where(
          and(
            eq(schema.friendships.status, 'ACCEPTED'),
            or(
              eq(schema.friendships.userLow, targetUserId),
              eq(schema.friendships.userHigh, targetUserId),
            ),
          ),
        )
        .toSQL();

      expect(query.sql).toContain('from "friendships"');
      expect(query.sql).toContain('"friendships"."status" = $1');
      expect(query.sql).toContain('"friendships"."user_low" = $2');
      expect(query.sql).toContain('"friendships"."user_high" = $3');
    });
  });

  describe('Conversation and Timeline Queries', () => {
    it('should generate direct conversation lookup with direct_key', () => {
      const directKey = 'user1:user2';
      const query = db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.directKey, directKey))
        .toSQL();

      expect(query.sql).toContain('from "conversations"');
      expect(query.sql).toContain('"conversations"."direct_key" = $1');
      expect(query.params).toEqual([directKey]);
    });

    it('should generate timeline cursor pagination query for messages', () => {
      const convId = '0193a2b1-0000-7000-8000-000000000002';
      const query = db
        .select()
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.conversationId, convId),
            isNull(schema.messages.deletedAt),
          ),
        )
        .orderBy(desc(schema.messages.id))
        .limit(20)
        .toSQL();

      expect(query.sql).toContain('from "messages"');
      expect(query.sql).toContain('"messages"."conversation_id" = $1');
      expect(query.sql).toContain('"messages"."deleted_at" is null');
      expect(query.sql).toContain('order by "messages"."id" desc');
      expect(query.sql).toContain('limit $2');
      expect(query.params).toEqual([convId, 20]);
    });
  });

  describe('Call Queries', () => {
    it('should generate active calls query', () => {
      const userId = '0193a2b1-0000-7000-8000-000000000001';
      const query = db
        .select()
        .from(schema.calls)
        .where(
          and(
            eq(schema.calls.calleeId, userId),
            eq(schema.calls.status, 'RINGING'),
          ),
        )
        .toSQL();

      expect(query.sql).toContain('from "calls"');
      expect(query.sql).toContain('"calls"."callee_id" = $1');
      expect(query.sql).toContain('"calls"."status" = $2');
      expect(query.params).toEqual([userId, 'RINGING']);
    });
  });

  describe('Story and Note Queries', () => {
    it('should generate active stories query (where expires_at > now)', () => {
      const now = new Date();
      const query = db
        .select()
        .from(schema.stories)
        .where(gt(schema.stories.expiresAt, now))
        .orderBy(desc(schema.stories.createdAt))
        .toSQL();

      expect(query.sql).toContain('from "stories"');
      expect(query.sql).toContain('"stories"."expires_at" > $1');
      expect(query.sql).toContain('order by "stories"."created_at" desc');
    });

    it('should generate active note lookup by userId', () => {
      const userId = '0193a2b1-0000-7000-8000-000000000001';
      const now = new Date();
      const query = db
        .select()
        .from(schema.notes)
        .where(
          and(
            eq(schema.notes.userId, userId),
            gt(schema.notes.expiresAt, now),
          ),
        )
        .toSQL();

      expect(query.sql).toContain('from "notes"');
      expect(query.sql).toContain('"notes"."user_id" = $1');
      expect(query.sql).toContain('"notes"."expires_at" > $2');
    });
  });
});

