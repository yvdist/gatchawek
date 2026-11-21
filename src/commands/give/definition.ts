import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const giveDefinition = {
  name: "give",
  description: "Lepas satu kartu ke siapa cepat dia dapat (kedaluwarsa 15 menit).",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "kartu",
      description: "Kartu milikmu yang mau dilepas.",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
