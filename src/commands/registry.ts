import {
  type APIChatInputApplicationCommandInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import type { Env } from "../env.js";
import { pingDefinition } from "./ping/definition.js";
import { handlePing, type CommandHandler } from "./ping/handler.js";
import { gachaDefinition } from "./gacha/definition.js";
import { handleGacha } from "./gacha/handler.js";
import { statusDefinition } from "./status/definition.js";
import { handleStatus } from "./status/handler.js";
import { resetDefinition } from "./reset/definition.js";
import { handleReset } from "./reset/handler.js";

export type WaitUntil = (promise: Promise<unknown>) => void;

export type CommandHandlerWithWait = (
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  waitUntil: WaitUntil,
) => APIInteractionResponse | Promise<APIInteractionResponse>;

export const commandDefinitions = [
  pingDefinition,
  gachaDefinition,
  statusDefinition,
  resetDefinition,
];

export const commandHandlers: Map<string, CommandHandler | CommandHandlerWithWait> =
  new Map([
    ["ping", handlePing],
    ["gacha", handleGacha],
    ["status", handleStatus],
    ["reset", handleReset],
  ]);
