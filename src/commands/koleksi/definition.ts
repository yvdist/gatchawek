import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const koleksiDefinition = {
  name: "koleksi",
  description: "Lihat koleksi photocard milikmu.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "pool",
      description: "Pool yang dilihat.",
      type: ApplicationCommandOptionType.String,
      required: true,
    },
    {
      name: "grup",
      description: "Filter seri dalam pool.",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    },
    {
      name: "publik",
      description: "Tampilkan ke semua orang; default hanya kamu.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    },
  ],
  poolOptionName: "pool",
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody & {
  poolOptionName: string;
};
