import { relations } from 'drizzle-orm';
import { conversations } from '../conversation/conversation.schema.js';
import { users } from '../user/user.schema.js';
import { calls } from './call.schema.js';

export const callsRelations = relations(calls, ({ one }) => ({
  conversation: one(conversations, {
    fields: [calls.conversationId],
    references: [conversations.id],
  }),
  caller: one(users, {
    fields: [calls.callerId],
    references: [users.id],
    relationName: 'caller',
  }),
  callee: one(users, {
    fields: [calls.calleeId],
    references: [users.id],
    relationName: 'callee',
  }),
}));

