import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const wishDefinition = {
  name: "wish",
  description: "Tandai kartu incaran (maks 3 per pool). Holo: ketik nama persis.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "kartu",
      description: "Kartu incaran. Kartu Holo tidak muncul di list, ketik namanya persis.",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;

export const unwishDefinition = {
  name: "unwish",
  description: "Hapus kartu dari wishlist.",
  contexts: [InteractionContextType.Guild],
  options: [
    {
      name: "kartu",
      description: "Kartu di wishlist-mu.",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
  ],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;

export const wishlistDefinition = {
  name: "wishlist",
  description: "Lihat wishlist dan pity tiap pool.",
  contexts: [InteractionContextType.Guild],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
