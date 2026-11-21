import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const kartuDefinition = {
  name: "kartu",
  description:
    "Tampilkan kartu identitas anggota & kolektor Discord (diri sendiri atau teman).",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "user",
      description:
        "Anggota yang ingin dilihat kartu identitasnya (kosongkan untuk diri sendiri).",
      type: ApplicationCommandOptionType.User,
      required: false,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
