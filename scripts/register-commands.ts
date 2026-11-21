import { readFile } from "node:fs/promises";
import {
  ApplicationCommandOptionType,
  type RESTPostAPIApplicationCommandsJSONBody,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import { commandDefinitions } from "../src/commands/registry.js";
// Load repo .env automatically so `pnpm register` works without manual export.
// No-op on old Node or when CI injects env directly (existing vars win).
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // Missing .env: fall back to process.env as-is.
  }
}

interface PoolEntry {
  id: string;
  name: string;
  hidden?: boolean;
}

interface CommandDefinitionWithPoolOption
  extends RESTPostAPIChatInputApplicationCommandsJSONBody {
  poolOptionName?: string;
}

const MAX_CHOICES = 25;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function injectPoolChoices(
  definition: RESTPostAPIChatInputApplicationCommandsJSONBody,
  choices: { name: string; value: string }[],
): RESTPostAPIChatInputApplicationCommandsJSONBody {
  const { poolOptionName, options } = definition as CommandDefinitionWithPoolOption;
  if (poolOptionName === undefined || options === undefined) {
    return definition;
  }
  const { poolOptionName: _dropped, ...clean } =
    definition as CommandDefinitionWithPoolOption;
  return {
    ...clean,
    options: options.map((option) => {
      if (
        option.type !== ApplicationCommandOptionType.String ||
        option.name !== poolOptionName
      ) {
        return option;
      }
      const { autocomplete: _droppedOption, ...stringOption } = option;
      return { ...stringOption, choices };
    }),
  };
}

async function main(): Promise<void> {
  const appId = requireEnv("DISCORD_APPLICATION_ID");
  const token = requireEnv("DISCORD_BOT_TOKEN");
  const guildId = requireEnv("GUILD_ID");

  const poolsRaw = await readFile(
    new URL("../data/pools.json", import.meta.url),
    "utf8",
  );
  const pools = JSON.parse(poolsRaw) as PoolEntry[];
  const choices = pools
    .filter((pool) => pool.hidden !== true)
    .slice(0, MAX_CHOICES)
    .map((pool) => ({ name: pool.name, value: pool.id }));

  const chatInputBody = commandDefinitions.map((definition) =>
    injectPoolChoices(definition, choices),
  );
  const body: RESTPostAPIApplicationCommandsJSONBody[] = chatInputBody;

  const url = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("register failed: " + String(res.status) + " " + text);
    process.exit(1);
  }
  console.log("registered " + String(body.length) + " command(s)");
}

await main();
