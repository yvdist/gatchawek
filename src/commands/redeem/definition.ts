import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const redeemDefinition = {
  name: "tukar-poin",
  description: "Tukar 100 poin lebur jadi 1 stamina pool pilihan.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "pool",
      description: "Pool yang stamina-nya ditambah.",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],
  poolOptionName: "pool",
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody & {
  poolOptionName: string;
};
