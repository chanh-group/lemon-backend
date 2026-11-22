// Shared handler body for `typing:start` / `typing:stop` — the two events are
// identical apart from the direction of the Redis key write and the broadcast
// payload flag. Extracted from ChatGateway — must never import
// gateway.ts / service.ts (no cycles).
import { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { Socket } from "socket.io";
import { typingKey } from "../../utils/cache/keys.js";
import type { ConversationPgRepository } from "../conversation/pg.js";
import { REALTIME_EVENTS, TYPING_KEY_VALUE, TYPING_TTL_SECS } from "./constants.js";
import { convRoom, userRoom } from "./rooms.js";

const logger = new Logger("ChatGateway");

export interface TypingDeps {
  conversationRepo: Pick<ConversationPgRepository, "getParticipantUserIds">;
  redis: Redis | null;
  /** Pending connection initialization — the handler must wait for it, like every other. */
  pending?: Promise<void>;
}

/** One implementation for both typing events, parameterized by `isTyping`. */
export async function handleTypingEvent(
  client: Socket,
  data: { conversationId: string },
  deps: TypingDeps,
  isTyping: boolean,
): Promise<void> {
  await deps.pending;
  const userId = client.data?.userId as string;
  if (!userId || !data?.conversationId) return;

  const room = convRoom(data.conversationId);
  const participantIds = await deps.conversationRepo.getParticipantUserIds(data.conversationId);
  if (!participantIds.includes(userId)) {
    if (client.rooms.has(room)) await client.leave(room);
    return;
  }

  // Cache typing indicator in Redis; fire-and-forget so keystroke events
  // never wait on Redis before the room broadcast.
  if (deps.redis) {
    const key = typingKey(data.conversationId, userId);
    const write = isTyping
      ? deps.redis.set(key, TYPING_KEY_VALUE, "EX", TYPING_TTL_SECS)
      : deps.redis.del(key);
    write.catch((err: unknown) => {
      logger.warn(
        isTyping ? "Redis typing cache write failed" : "Redis typing cache delete failed",
        { err },
      );
    });
  }

  const recipientRooms = participantIds.filter((id) => id !== userId).map(userRoom);
  if (recipientRooms.length === 0) return;
  client.to(recipientRooms).emit(REALTIME_EVENTS.TYPING, {
    conversationId: data.conversationId,
    userId,
    isTyping,
  });
}
