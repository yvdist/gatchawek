import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Offline content gate (spec 02 §1, 03 §10). Phase 0 ships the stub: it reports
 * that no catalog exists yet instead of pretending content is valid.
 * Phase 2 replaces the body with the real budget/DSL validator.
 */
const CONTENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content");

async function main(): Promise<void> {
  const catalogFile = path.join(CONTENT_DIR, "catalog.v1.json");
  try {
    const raw = await readFile(catalogFile, "utf8");
    JSON.parse(raw);
    console.log(`validate-content: ${path.relative(process.cwd(), catalogFile)} terbaca (validasi budget belum aktif).`);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      console.log("validate-content: belum ada katalog kartu (stub Fase 0, tidak ada yang divalidasi).");
      return;
    }
    throw error;
  }
}

await main();
