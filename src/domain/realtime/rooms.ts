// Socket.io room naming — single source of truth for room identifiers.
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function convRoom(conversationId: string): string {
  return `conv:${conversationId}`;
}
