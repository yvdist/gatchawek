import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponentWithURL,
} from "discord-api-types/v10";

export const WA_SHARE_BUTTON_LABEL = "📤 Share ke WA";

export function buildWaShareRow(
  shareUrl: string,
): APIActionRowComponent<APIButtonComponentWithURL> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: WA_SHARE_BUTTON_LABEL,
        url: shareUrl,
      },
    ],
  };
}
