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
  | "MAX_DURATION"
  | "WINDOW_CLOSED"
  | "USER_HANGUP"
  | "USER_DECLINED"
  | "CALLEE_OFFLINE"
  | "BUSY"
  | "FAILED";

export type CallRejectReason = "USER_DECLINED" | "CALLEE_OFFLINE" | "BUSY";

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
  reason?: CallRejectReason;
}

export interface CallCancelledPayload {
  callId: string;
  cancelledBy: string;
}

export interface CallMissedPayload {
  callId: string;
  callerId: string;
  media: CallMedia;
  reason: CallEndReason;
}

export interface CallEndedPayload {
  callId: string;
  endedBy?: string;
  reason: CallEndReason;
  durationSecs: number;
}
