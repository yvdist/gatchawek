import {
  loadManifests,
  ManifestError,
  rarityWarnings,
  summarize,
} from "./lib/manifests.js";

async function main(): Promise<void> {
  let loaded;
  try {
    loaded = await loadManifests();
  } catch (err: unknown) {
    if (err instanceof ManifestError) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  for (const line of summarize(loaded)) {
    console.log(line);
  }
  for (const warning of rarityWarnings(loaded)) {
    console.warn(warning);
  }
}

await main();
