import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const resetDefinition = {
  name: "reset",
  description: "Isi penuh stamina satu pool (cooldown berlaku).",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "pool",
      description: "Pool yang di-reset.",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
  poolOptionName: "pool",
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody & {
  poolOptionName: string;
};
