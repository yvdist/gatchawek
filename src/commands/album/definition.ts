import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const albumDefinition = {
  name: "album",
  description:
    "Buka buku pengumpul photocard interaktif milikmu lewat tautan sekali pakai.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "pool",
      description: "Buka langsung pada tab pool tertentu (opsional).",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
