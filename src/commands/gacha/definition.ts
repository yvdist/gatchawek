import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const gachaDefinition = {
  name: "gacha",
  description: "Tarik satu photocard dari pool pilihan.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "pool",
      description: "Pool kartu yang ditarik.",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
  poolOptionName: "pool",
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody & {
  poolOptionName: string;
};
