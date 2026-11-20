import type { CursorPage } from "../shared.js";
import type { Call } from "./schema.js";
import type { CallWithUsers } from "./types.js";

export interface CreateCallInput {
  conversationId: string;
  callerId: string;
  calleeId: string;
  media: "VOICE" | "VIDEO";
}

export interface UpdateCallStatusInput {
  status: Call["status"];
  answeredAt?: Date;
  endedAt?: Date;
  endReason?: string;
}

export interface CallRepository {
  createCall(input: CreateCallInput): Promise<CallWithUsers>;
  findById(callId: string): Promise<CallWithUsers | null>;
  findActiveCallForUser(userId: string): Promise<CallWithUsers | null>;
  updateStatus(
    callId: string,
    expectedStatuses: Array<Call["status"]>,
    updates: UpdateCallStatusInput,
  ): Promise<CallWithUsers | null>;
  findCallsByConversation(
    conversationId: string,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<CallWithUsers>>;
  findCallsByUser(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<CallWithUsers>>;
}

export const CALL_REPOSITORY = Symbol("CALL_REPOSITORY");
