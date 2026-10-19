import { describe, expect, it, vi } from "vitest";
import { RealtimeService } from "../../../../src/domain/realtime/realtime.service.js";
import type { ChatGateway } from "../../../../src/domain/realtime/chat.gateway.js";

describe("RealtimeService", () => {
  function createService(to: ReturnType<typeof vi.fn>): RealtimeService {
    return new RealtimeService({ server: { to } } as unknown as ChatGateway);
  }

  describe("emitNewMessage", () => {
    it("emits message:new exactly once to the conversation room", () => {
      const emit = vi.fn();
      const to = vi.fn().mockReturnValue({ emit });
      const service = createService(to);

      service.emitNewMessage("c1", { id: "m1" });

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
      legacyCall("c1", { id: "m1" }, ["u2", "u3"]);

      expect(to).toHaveBeenCalledTimes(1);
      expect(to).not.toHaveBeenCalledWith("user:u2");
      expect(to).not.toHaveBeenCalledWith("user:u3");
    });

    it("does nothing when the gateway server is not initialized", () => {
      const service = new RealtimeService({ server: undefined } as unknown as ChatGateway);

      expect(() => service.emitNewMessage("c1", { id: "m1" })).not.toThrow();
    });

    it("swallows socket emit failures", () => {
      const to = vi.fn().mockImplementation(() => {
        throw new Error("socket down");
      });
      const service = createService(to);

      expect(() => service.emitNewMessage("c1", { id: "m1" })).not.toThrow();
    });
  });
});
