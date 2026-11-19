import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllCards, registerFonts } from "./lib/build-cards.js";
import { collectCardInputs } from "./lib/card-inputs.js";
import { resolveManifestRoot } from "./lib/manifests.js";

async function main(): Promise<void> {
  const root = resolveManifestRoot();
  registerFonts(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts"),
  );
  const { inputs, skipped } = await collectCardInputs(root);
  const built = await buildAllCards(inputs, path.join(root, "public", "cards"));
  for (const skip of skipped) {
    console.warn(`warning: skipping ${skip.cardId}: ${skip.reason}`);
  }
  console.log(`built ${built.length} card(s), skipped ${skipped.length}`);
}

await main();
