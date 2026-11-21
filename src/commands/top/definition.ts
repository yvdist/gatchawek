import {
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const topDefinition = {
  name: "top",
  description: "Papan peringkat level, kolektor, dan pemilik holo.",
  contexts: [InteractionContextType.Guild],
  options: [],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
