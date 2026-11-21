import {
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const kartuDefinition = {
  name: "kartu",
  description: "Tampilkan kartu identitas anggota & kolektor Discord milikmu.",
  contexts: [InteractionContextType.Guild],
} as const satisfies RESTPostAPIChatInputApplicationCommandsJSONBody;
