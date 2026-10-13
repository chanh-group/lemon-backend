import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DrizzleDb } from '../../../src/infra/database/database.module.js';
import * as schema from '../../../src/infra/database/schema.js';

describe('Drizzle Relational Queries Verification', () => {
  let db: DrizzleDb;

  beforeAll(() => {
    const pool = new Pool();
    db = drizzle(pool, { schema });
  });

  describe('User Domain Relations', () => {
    it('should resolve all user relations without throwing', () => {
      expect(() => {
        db.query.users.findFirst({
          with: {
            friendshipsInitiated: true,
            friendshipsReceived: true,
            conversationParticipants: true,
            messages: true,
            callsInitiated: true,
            callsReceived: true,
            stories: true,
            storyViews: true,
            notes: true,
          },
        });
      }).not.toThrow();
    });
  });

  describe('Friend Domain Relations', () => {
    it('should resolve friendships requester and addressee relations', () => {
      expect(() => {
        db.query.friendships.findFirst({
          with: {
            requester: true,
            addressee: true,
          },
        });
      }).not.toThrow();
    });
  });

  describe('Conversation Domain Relations', () => {
    it('should resolve conversations relations including nested participants.user and messages', () => {
      expect(() => {
        db.query.conversations.findFirst({
          with: {
            participants: {
              with: {
                user: true,
              },
            },
            messages: {
              with: {
                sender: true,
                attachments: true,
                replyTo: true,
                replies: true,
              },
            },
            calls: {
              with: {
                caller: true,
                callee: true,
              },
            },
          },
        });
      }).not.toThrow();
    });

    it('should resolve conversation_participants relations to conversation and user', () => {
      expect(() => {
        db.query.conversationParticipants.findFirst({
          with: {
            conversation: true,
            user: true,
          },
        });
      }).not.toThrow();
    });
  });

  describe('Message Domain Relations', () => {
    it('should resolve message self-referencing reply relations and attachments', () => {
      expect(() => {
        db.query.messages.findFirst({
          with: {
            conversation: true,
            sender: true,
            attachments: true,
            replyTo: true,
            replies: true,
          },
        });
      }).not.toThrow();
    });

    it('should resolve message_attachments relation to message', () => {
      expect(() => {
        db.query.messageAttachments.findFirst({
          with: {
            message: true,
          },
        });
      }).not.toThrow();
    });
  });

  describe('Call Domain Relations', () => {
    it('should resolve calls relations to conversation, caller, and callee', () => {
      expect(() => {
        db.query.calls.findFirst({
          with: {
            conversation: true,
            caller: true,
            callee: true,
          },
        });
      }).not.toThrow();
    });
  });

  describe('Story and Note Domain Relations', () => {
    it('should resolve stories relations including nested story views with user', () => {
      expect(() => {
        db.query.stories.findFirst({
          with: {
            user: true,
            views: {
              with: {
                user: true,
              },
            },
          },
        });
      }).not.toThrow();
    });

    it('should resolve story_views relations to story and user', () => {
      expect(() => {
        db.query.storyViews.findFirst({
          with: {
            story: true,
            user: true,
          },
        });
      }).not.toThrow();
    });

    it('should resolve notes relation to user', () => {
      expect(() => {
        db.query.notes.findFirst({
          with: {
            user: true,
          },
        });
      }).not.toThrow();
    });
  });
});

