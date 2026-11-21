import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const giveToDefinition = {
  name: "give-to",
  description: "Hadiahkan satu kartu ke teman; dia harus Terima/Tolak (15 menit).",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "user",
      description: "Teman yang diberi kartu.",
      type: ApplicationCommandOptionType.User,
      required: true,
    },
    {
      name: "kartu",
      description: "Kartu milikmu yang mau dihadiahkan.",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
