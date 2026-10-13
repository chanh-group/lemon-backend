import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DrizzleDb } from '../../../src/configs/database.module.js';
import * as schema from '../../../src/configs/schema.js';

describe('SQL-First Joins via Foreign Keys Verification', () => {
  let db: DrizzleDb;

  beforeAll(() => {
    const pool = new Pool();
    db = drizzle(pool, { schema });
  });

  it('should generate valid SQL joining conversations with participants and users', () => {
    const query = db
      .select({
        conversationId: schema.conversations.id,
        kind: schema.conversations.kind,
        userId: schema.users.id,
        username: schema.users.username,
        role: schema.conversationParticipants.role,
      })
      .from(schema.conversations)
      .innerJoin(
        schema.conversationParticipants,
        eq(schema.conversations.id, schema.conversationParticipants.conversationId),
      )
      .innerJoin(
        schema.users,
        eq(schema.conversationParticipants.userId, schema.users.id),
      )
      .where(eq(schema.conversations.id, '0193a2b1-0000-7000-8000-000000000001'))
      .toSQL();

    expect(query.sql).toContain('inner join "conversation_participants"');
    expect(query.sql).toContain('inner join "users"');
    expect(query.sql).toContain('"conversations"."id" = "conversation_participants"."conversation_id"');
    expect(query.sql).toContain('"conversation_participants"."user_id" = "users"."id"');
  });

  it('should generate valid SQL joining messages with sender and attachments', () => {
    const query = db
      .select({
        messageId: schema.messages.id,
        body: schema.messages.body,
        senderUsername: schema.users.username,
        attachmentKey: schema.messageAttachments.objectKey,
      })
      .from(schema.messages)
      .leftJoin(schema.users, eq(schema.messages.senderId, schema.users.id))
      .leftJoin(
        schema.messageAttachments,
        eq(schema.messages.id, schema.messageAttachments.messageId),
      )
      .where(eq(schema.messages.conversationId, '0193a2b1-0000-7000-8000-000000000002'))
      .toSQL();

    expect(query.sql).toContain('left join "users"');
    expect(query.sql).toContain('left join "message_attachments"');
    expect(query.sql).toContain('"messages"."sender_id" = "users"."id"');
    expect(query.sql).toContain('"messages"."id" = "message_attachments"."message_id"');
  });

  it('should generate valid SQL joining self-referencing messages for reply-to', () => {
    const replyMessages = alias(schema.messages, 'replied_msg');

    const query = db
      .select({
        id: schema.messages.id,
        body: schema.messages.body,
        replyToBody: replyMessages.body,
      })
      .from(schema.messages)
      .leftJoin(replyMessages, eq(schema.messages.replyToId, replyMessages.id))
      .where(eq(schema.messages.conversationId, '0193a2b1-0000-7000-8000-000000000002'))
      .toSQL();

    expect(query.sql).toContain('left join "messages" "replied_msg"');
    expect(query.sql).toContain('"messages"."reply_to_id" = "replied_msg"."id"');
  });

  it('should generate valid SQL joining friendships with requester and addressee', () => {
    const requester = alias(schema.users, 'requester');
    const addressee = alias(schema.users, 'addressee');

    const query = db
      .select({
        friendshipId: schema.friendships.id,
        status: schema.friendships.status,
        requesterName: requester.username,
        addresseeName: addressee.username,
      })
      .from(schema.friendships)
      .innerJoin(requester, eq(schema.friendships.requesterId, requester.id))
      .innerJoin(addressee, eq(schema.friendships.addresseeId, addressee.id))
      .where(eq(schema.friendships.status, 'ACCEPTED'))
      .toSQL();

    expect(query.sql).toContain('inner join "users" "requester"');
    expect(query.sql).toContain('inner join "users" "addressee"');
    expect(query.sql).toContain('"friendships"."requester_id" = "requester"."id"');
    expect(query.sql).toContain('"friendships"."addressee_id" = "addressee"."id"');
  });

  it('should generate valid SQL joining calls with caller, callee, and conversation', () => {
    const caller = alias(schema.users, 'caller');
    const callee = alias(schema.users, 'callee');

    const query = db
      .select({
        callId: schema.calls.id,
        media: schema.calls.media,
        status: schema.calls.status,
        callerName: caller.username,
        calleeName: callee.username,
      })
      .from(schema.calls)
      .innerJoin(caller, eq(schema.calls.callerId, caller.id))
      .innerJoin(callee, eq(schema.calls.calleeId, callee.id))
      .innerJoin(schema.conversations, eq(schema.calls.conversationId, schema.conversations.id))
      .toSQL();

    expect(query.sql).toContain('inner join "users" "caller"');
    expect(query.sql).toContain('inner join "users" "callee"');
    expect(query.sql).toContain('inner join "conversations"');
    expect(query.sql).toContain('"calls"."caller_id" = "caller"."id"');
    expect(query.sql).toContain('"calls"."callee_id" = "callee"."id"');
  });

  it('should generate valid SQL joining stories with views and users', () => {
    const viewer = alias(schema.users, 'viewer');

    const query = db
      .select({
        storyId: schema.stories.id,
        caption: schema.stories.caption,
        authorUsername: schema.users.username,
        viewerUsername: viewer.username,
      })
      .from(schema.stories)
      .innerJoin(schema.users, eq(schema.stories.userId, schema.users.id))
      .leftJoin(schema.storyViews, eq(schema.stories.id, schema.storyViews.storyId))
      .leftJoin(viewer, eq(schema.storyViews.userId, viewer.id))
      .toSQL();

    expect(query.sql).toContain('inner join "users"');
    expect(query.sql).toContain('left join "story_views"');
    expect(query.sql).toContain('left join "users" "viewer"');
    expect(query.sql).toContain('"stories"."user_id" = "users"."id"');
    expect(query.sql).toContain('"stories"."id" = "story_views"."story_id"');
  });
});

