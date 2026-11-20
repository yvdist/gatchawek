import {
  InteractionContextType,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";

export const injectReviewDefinition: RESTPostAPIChatInputApplicationCommandsJSONBody = {
  name: "inject-review",
  description: "Review antrean kartu inject komunitas (kurator).",
  contexts: [InteractionContextType.Guild],
};
