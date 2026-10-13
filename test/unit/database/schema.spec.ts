import { describe, expect, it } from 'vitest';
import * as schema from '../../../src/infra/database/schema.js';

describe('Database Schema Exports', () => {
  it('should export all 10 domain tables', () => {
    expect(schema.users).toBeDefined();
    expect(schema.friendships).toBeDefined();
    expect(schema.conversations).toBeDefined();
    expect(schema.conversationParticipants).toBeDefined();
    expect(schema.messages).toBeDefined();
    expect(schema.messageAttachments).toBeDefined();
    expect(schema.calls).toBeDefined();
    expect(schema.stories).toBeDefined();
    expect(schema.storyViews).toBeDefined();
    expect(schema.notes).toBeDefined();
  });

  it('should export all 8 enums', () => {
    expect(schema.friendshipStatusEnum).toBeDefined();
    expect(schema.conversationKindEnum).toBeDefined();
    expect(schema.participantRoleEnum).toBeDefined();
    expect(schema.messageKindEnum).toBeDefined();
    expect(schema.attachmentKindEnum).toBeDefined();
    expect(schema.callMediaEnum).toBeDefined();
    expect(schema.callStatusEnum).toBeDefined();
    expect(schema.storyKindEnum).toBeDefined();
  });

  it('should export all domain relations', () => {
    expect(schema.usersRelations).toBeDefined();
    expect(schema.friendshipsRelations).toBeDefined();
    expect(schema.conversationsRelations).toBeDefined();
    expect(schema.conversationParticipantsRelations).toBeDefined();
    expect(schema.messagesRelations).toBeDefined();
    expect(schema.messageAttachmentsRelations).toBeDefined();
    expect(schema.callsRelations).toBeDefined();
    expect(schema.storiesRelations).toBeDefined();
    expect(schema.storyViewsRelations).toBeDefined();
    expect(schema.notesRelations).toBeDefined();
  });
});

