/**
 * Singleton DO for the ranked queue and public room search (spec 03 §2).
 * Phase 3 fills it in; Phase 0 only proves the binding works.
 */
export class Matchmaker implements DurableObject {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(): Promise<Response> {
    await this.ctx.storage.get("queue");
    return new Response("Matchmaker belum aktif (Fase 0).", { status: 501 });
  }
}
