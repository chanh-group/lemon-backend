// Shared bootstrap/config defaults. Single source for the dev origins so
// main.ts and the WebSocket adapter cannot drift apart.
export const DEFAULT_FRONTEND_URL = "http://localhost:5173";
export const DEFAULT_LOCALHOST_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];
