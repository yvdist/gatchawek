import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const cariDefinition = {
  name: "cari",
  description: "Cari karakter dan lihat siapa yang mengoleksinya.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "nama",
      description: "Nama karakter/member.",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "pool",
      description: "Batasi ke pool tertentu; kosongkan untuk semua pool.",
      type: ApplicationCommandOptionType.String,
      required: false,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
