import { describe, expect, it } from 'vitest';
import * as schema from '../../../src/configs/schema.js';

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

  it('should export custom types and helpers', () => {
    expect(schema.citext).toBeDefined();
    expect(schema.timestamps).toBeDefined();
    expect(schema.timestamps.createdAt).toBeDefined();
    expect(schema.timestamps.updatedAt).toBeDefined();
    expect(schema.generateUuidV7).toBeDefined();
  });

  describe('generateUuidV7 helper', () => {
    it('should generate valid RFC 9562 UUIDv7 string format', () => {
      const id = schema.generateUuidV7();
      expect(typeof id).toBe('string');
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('should produce strictly monotonic (time-ordered) IDs', () => {
      const count = 10;
      const ids = Array.from({ length: count }, () => schema.generateUuidV7());
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i] > ids[i - 1]).toBe(true);
      }
    });
  });
});
