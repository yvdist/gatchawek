import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const tradeDefinition = {
  name: "trade",
  description: "Tukar kartu photocard dengan teman.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "user",
      description: "Teman yang diajak tukar.",
      type: ApplicationCommandOptionType.User,
      required: true,
    },
    {
      name: "offer",
      description: "Kartu milikmu yang ditawarkan.",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "request",
      description: "Kartu miliknya yang kamu mau.",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
