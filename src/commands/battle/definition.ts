import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const battleDefinition = {
  name: "battle",
  description: "Tantang teman adu photocard 1v1 (Blind Pick).",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "user",
      description: "Teman yang ditantang bertarung.",
      type: ApplicationCommandOptionType.User,
      required: true,
    },
    {
      name: "card",
      description: "Kartu milikmu yang dipasang (disembunyikan).",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "mode",
      description: "Mode battle: santai atau taruhan kartu (default: santai).",
      type: ApplicationCommandOptionType.String,
      required: false,
      choices: [
        { name: "🎮 Santai (Kartu Aman)", value: "casual" },
        { name: "🔥 Taruhan (Rebut 1 Kartu Lawan)", value: "wager" },
      ],
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
