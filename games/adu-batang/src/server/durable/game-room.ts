/**
 * One instance per match (spec 03 §3). Phase 0 only proves the binding and the
 * SQLite-backed class exist; P0-T6 adds the WebSocket Hibernation echo.
 */
export class GameRoom implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(): Promise<Response> {
    await this.ctx.storage.get("state");
    return new Response("GameRoom belum aktif (Fase 0).", { status: 501 });
  }
}
