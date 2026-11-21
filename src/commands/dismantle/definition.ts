import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const dismantleDefinition = {
  name: "dismantle",
  description: "Lebur satu duplikat jadi poin (copy terakhir aman).",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "kartu",
      description: "Kartu duplikat milikmu yang mau dilebur.",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
