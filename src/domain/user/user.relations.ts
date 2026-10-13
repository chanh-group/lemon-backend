import { relations } from 'drizzle-orm';
import { calls } from '../call/call.schema.js';
import { conversationParticipants } from '../conversation/conversation.schema.js';
import { friendships } from '../friend/friend.schema.js';
import { messages } from '../message/message.schema.js';
import { notes } from '../note/note.schema.js';
import { stories, storyViews } from '../story/story.schema.js';
import { users } from './user.schema.js';

export const usersRelations = relations(users, ({ many }) => ({
  friendshipsInitiated: many(friendships, { relationName: 'requester' }),
  friendshipsReceived: many(friendships, { relationName: 'addressee' }),
  conversationParticipants: many(conversationParticipants),
  messages: many(messages),
  callsInitiated: many(calls, { relationName: 'caller' }),
  callsReceived: many(calls, { relationName: 'callee' }),
  stories: many(stories),
  storyViews: many(storyViews),
  notes: many(notes),
}));

