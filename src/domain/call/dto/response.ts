import type { CallMedia, CallParticipant, CallStatus, RTCIceServer } from "../types.js";

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

export interface InitiateCallResponse extends CallResponse {
  iceServers: RTCIceServer[];
}

export interface AcceptCallResponse extends CallResponse {
  iceServers: RTCIceServer[];
}

export interface IceServersResponse {
  iceServers: RTCIceServer[];
}
