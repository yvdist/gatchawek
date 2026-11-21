import { createApp } from "../../src/server/app.js";

export { GameRoom } from "../../src/server/durable/game-room.js";
export { Matchmaker } from "../../src/server/durable/matchmaker.js";

// Same app and DO classes as production, minus the Sentry wrapper (not needed
// to prove the WebSocket round trip).
export default createApp();
