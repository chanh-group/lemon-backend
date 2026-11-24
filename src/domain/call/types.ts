export interface LiveKitConnectionDetails {
  serverUrl: string;
  room: string;
  token: string;
}

export type CallMedia = "VOICE" | "VIDEO";

export type CallStatus =
  | "INITIATED"
  | "RINGING"
  | "ACCEPTED"
  | "REJECTED"
  | "MISSED"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export type CallEndReason =
  | "NORMAL"
  | "REJECTED"
  | "MISSED_TIMEOUT"
  | "CANCELLED"
  | "DISCONNECTED_TIMEOUT"
  | "BUSY"
  | "FAILED";

export interface CallParticipant {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface CallWithUsers {
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
  durationSecs: number | null;
  caller?: CallParticipant;
  callee?: CallParticipant;
}

export interface CallIncomingPayload {
  callId: string;
  conversationId: string;
  caller: CallParticipant;
  media: CallMedia;
}

export interface CallAcceptedPayload {
  callId: string;
  acceptedBy: string;
  answeredAt: Date;
  livekit?: LiveKitConnectionDetails;
}

export interface CallRejectedPayload {
  callId: string;
  rejectedBy: string;
  reason?: string;
}

export interface CallCancelledPayload {
  callId: string;
  cancelledBy: string;
}

export interface CallMissedPayload {
  callId: string;
  callerId: string;
  media: CallMedia;
  reason: string;
}

export interface CallEndedPayload {
  callId: string;
  endedBy?: string;
  reason: string;
  durationSecs: number;
}
