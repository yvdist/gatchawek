import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const listDefinition = {
  name: "list",
  description: "Lihat daftar kartu yang tersedia berdasarkan pool atau grup.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "pool",
      description: "Filter berdasarkan pool; kosongkan untuk semua pool.",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    },
    {
      name: "grup",
      description: "Filter berdasarkan grup/seri.",
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
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
