import {
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const statusDefinition = {
  name: "status",
  description: "Lihat sisa tarik, cooldown reset, dan progres tiap pool.",
  contexts: [InteractionContextType.Guild],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
