import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";
import { InteractionContextType } from "discord-api-types/v10";

export const helpDefinition = {
  name: "help",
  description: "Panduan main, rate rarity, dan daftar seri.",
  contexts: [InteractionContextType.Guild],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
