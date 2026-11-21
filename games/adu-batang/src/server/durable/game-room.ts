/**
 * One instance per match (spec 03 §3). Phase 0 only proves the round trip:
 * Hibernation API accept in, echo back out. Game state lands in Phase 1/3.
 */
export class GameRoom implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Butuh koneksi WebSocket.", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation API: no server.accept(), so an idle room is not billed.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") ws.send(`echo: ${message}`);
  }
}
