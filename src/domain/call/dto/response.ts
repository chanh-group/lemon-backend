import type { CallMedia, CallParticipant, CallStatus, LiveKitConnectionDetails } from "../types.js";

export interface CallResponse {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  media: CallMedia;
  status: CallStatus;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
  durationSecs: number;
  caller?: CallParticipant;
  callee?: CallParticipant;
}

export type InitiateCallResponse = CallResponse;

export interface AcceptCallResponse extends CallResponse {
  livekit: LiveKitConnectionDetails;
}

export interface CallTokenResponse {
  serverUrl: string;
  room: string;
  token: string;
}
