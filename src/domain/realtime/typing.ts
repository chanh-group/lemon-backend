// Shared handler body for `typing:start` / `typing:stop` — the two events are
// identical apart from the direction of the Redis key write and the broadcast
// payload flag. Extracted from ChatGateway — must never import
// gateway.ts / service.ts (no cycles).
import { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { Socket } from "socket.io";
import { typingKey } from "../../utils/cache/keys.js";
import { REALTIME_EVENTS, TYPING_KEY_VALUE, TYPING_TTL_SECS } from "./constants.js";
import { convRoom } from "./rooms.js";

const logger = new Logger("ChatGateway");

export interface TypingDeps {
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
  // Room membership is maintained by gateway connection/join and by
  // leaveConversation on removal. Checking it locally avoids a DB round trip
  // on every keystroke — typing events are high-frequency by nature.
  if (!client.rooms.has(room)) return;

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

  // Broadcast to the conversation room; socket.io excludes this sender.
  client.to(room).emit(REALTIME_EVENTS.TYPING, {
    conversationId: data.conversationId,
    userId,
    isTyping,
  });
}
