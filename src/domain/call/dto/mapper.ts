import type { CallWithUsers } from "../types.js";
import type { CallResponse } from "./response.js";

export function toCallResponse(call: CallWithUsers): CallResponse {
  return {
    id: call.id,
    conversationId: call.conversationId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    media: call.media,
    status: call.status,
    startedAt: call.startedAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    endReason: call.endReason,
    durationSecs: call.durationSecs ?? 0,
    ...(call.caller && { caller: call.caller }),
    ...(call.callee && { callee: call.callee }),
  };
}
