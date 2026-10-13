import { relations } from 'drizzle-orm';
import { calls } from '../call/call.schema.js';
import { messages } from '../message/message.schema.js';
import { users } from '../user/user.schema.js';
import { conversationParticipants, conversations } from './conversation.schema.js';

export const conversationsRelations = relations(conversations, ({ many }) => ({
  participants: many(conversationParticipants),
  messages: many(messages),
  calls: many(calls),
}));

export const conversationParticipantsRelations = relations(
  conversationParticipants,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationParticipants.conversationId],
      references: [conversations.id],
    }),
    user: one(users, {
      fields: [conversationParticipants.userId],
      references: [users.id],
    }),
  }),
);

