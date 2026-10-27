import { describe, expect, it, vi } from "vitest";
import { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";
import { convRoom, userRoom } from "../../../../src/domain/realtime/rooms.js";
import type { ChatGateway } from "../../../../src/domain/realtime/chat.gateway.js";
import type { MessageResponse } from "../../../../src/domain/message/dto/response.js";

const message = { id: "m1" } as MessageResponse;

describe("RealtimeService", () => {
  function createService(to: ReturnType<typeof vi.fn>): RealtimeService {
    return new RealtimeService({ server: { to } } as unknown as ChatGateway);
  }

  describe("emitNewMessage", () => {
    it("emits message:new exactly once to the conversation room", () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      const service = createService(to);

      service.emitNewMessage("c1", message);

      expect(to).toHaveBeenCalledTimes(1);
      expect(to).toHaveBeenCalledWith("conv:c1");
      expect(emit).toHaveBeenCalledWith("message:new", { id: "m1" });
    });

    it("does not emit to individual user rooms", () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      const service = createService(to);

      const legacyCall = service.emitNewMessage.bind(service) as (
        conversationId: string,
        message: unknown,
        recipientUserIds?: string[],
      ) => void;
      legacyCall("c1", message, ["u2", "u3"]);

      expect(to).toHaveBeenCalledTimes(1);
      expect(to).not.toHaveBeenCalledWith("user:u2");
      expect(to).not.toHaveBeenCalledWith("user:u3");
    });

    it("does nothing when the gateway server is not initialized", () => {
      const service = new RealtimeService({ server: undefined } as unknown as ChatGateway);

      expect(() => service.emitNewMessage("c1", message)).not.toThrow();
    });

    it("swallows socket emit failures", () => {
      const to = vi.fn().mockImplementation(() => {
        throw new Error("socket down");
      });
      const service = createService(to);

      expect(() => service.emitNewMessage("c1", message)).not.toThrow();
    });
  });

  describe("emitMessageRevoked", () => {
    it("includes the conversation id in the event payload", () => {
      const emit = vi.fn();
      const service = createService(vi.fn().mockReturnValue({ emit }));
      const deletedAt = new Date();

      service.emitMessageRevoked("c1", { id: "m1", deletedAt });

      expect(emit).toHaveBeenCalledWith("message:revoked", {
        id: "m1",
        deletedAt,
        conversationId: "c1",
      });
    });
  });

  describe("emitReadUpdated", () => {
    it("includes the conversation id in the event payload", () => {
      const emit = vi.fn();
      const service = createService(vi.fn().mockReturnValue({ emit }));
      const readAt = new Date();

      service.emitReadUpdated("c1", { userId: "u1", lastReadMessageId: "m1", readAt });

      expect(emit).toHaveBeenCalledWith("read:updated", {
        userId: "u1",
        lastReadMessageId: "m1",
        readAt,
        conversationId: "c1",
      });
    });
  });

  describe("emitFriendRequestReceived", () => {
    it("emits the request to only the recipient's user room", () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      const service = createService(to);
      const payload = {
        id: "request-id",
        user: { id: "requester-id", name: "Requester", username: "requester" },
      };

      service.emitFriendRequestReceived("recipient-id", payload);

      expect(to).toHaveBeenCalledWith(userRoom("recipient-id"));
      expect(emit).toHaveBeenCalledWith("friend:request:new", payload);
    });
  });

  describe("joinConversation", () => {
    it("makes every socket of each participant join the conversation room", () => {
      const socketsJoin = vi.fn();
      const inRoom = vi.fn().mockReturnValue({ socketsJoin });
      const service = new RealtimeService({ server: { in: inRoom } } as unknown as ChatGateway);

      service.joinConversation(["u1", "u2"], "c1");

      expect(inRoom).toHaveBeenCalledTimes(2);
      expect(inRoom).toHaveBeenNthCalledWith(1, userRoom("u1"));
      expect(inRoom).toHaveBeenNthCalledWith(2, userRoom("u2"));
      expect(socketsJoin).toHaveBeenCalledTimes(2);
      expect(socketsJoin).toHaveBeenNthCalledWith(1, convRoom("c1"));
      expect(socketsJoin).toHaveBeenNthCalledWith(2, convRoom("c1"));
    });

    it("does nothing when the gateway server is not initialized", () => {
      const service = new RealtimeService({ server: undefined } as unknown as ChatGateway);

      expect(() => service.joinConversation(["u1", "u2"], "c1")).not.toThrow();
    });

    it("swallows socket join failures", () => {
      const inRoom = vi.fn().mockImplementation(() => {
        throw new Error("socket down");
      });
      const service = new RealtimeService({ server: { in: inRoom } } as unknown as ChatGateway);

      expect(() => service.joinConversation(["u1"], "c1")).not.toThrow();
    });
  });
});
