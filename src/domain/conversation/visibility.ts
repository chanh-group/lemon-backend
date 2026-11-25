import { sql, type SQL } from "drizzle-orm";
import { messages } from "../message/schema.js";
import { conversationParticipants } from "./schema.js";

/**
 * The single history-boundary rule for "can this viewer see this message?".
 * Used by access checks, recipient fan-out and unread counts so those endpoints
 * cannot disagree about what is visible after a user joins or leaves a group.
 *
 * `conversationFilter` pins the subquery to either the joined participant row
 * (unread counts) or an explicit conversation id (recipient lookups).
 */
export function messageVisibleToParticipant(conversationFilter: SQL): SQL {
  return sql`(
    (${conversationParticipants.historyBoundaryMessageId} IS NOT NULL AND ROW(${messages.createdAt}, ${messages.id}) > (
      SELECT m.created_at, m.id FROM messages m
      WHERE m.id = ${conversationParticipants.historyBoundaryMessageId}
        AND ${conversationFilter}
    ))
    OR (${conversationParticipants.historyBoundaryMessageId} IS NULL AND ${conversationParticipants.historyBoundaryWasEmpty} = true)
    OR (${conversationParticipants.historyBoundaryMessageId} IS NULL AND ${conversationParticipants.historyBoundaryWasEmpty} = false AND ${messages.createdAt} > ${conversationParticipants.joinedAt})
  )`;
}
