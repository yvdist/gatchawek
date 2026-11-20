import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const pamerDefinition = {
  name: "pamer",
  description: "Pamerkan satu kartu milikmu ke server.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "kartu",
      description: "Kartu yang dipamerkan (urutan rarity tertinggi).",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "caption",
      description: "Kata-kata pamer (maks 140 karakter).",
      type: ApplicationCommandOptionType.String,
      required: false,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
