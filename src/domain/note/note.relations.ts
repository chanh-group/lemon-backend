import { relations } from 'drizzle-orm';
import { users } from '../user/user.schema.js';
import { notes } from './note.schema.js';

export const notesRelations = relations(notes, ({ one }) => ({
  user: one(users, {
    fields: [notes.userId],
    references: [users.id],
  }),
}));

