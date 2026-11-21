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
import { koleksiDefinition } from "./koleksi/definition.js";
import { handleKoleksi } from "./koleksi/handler.js";
import { helpDefinition } from "./help/definition.js";
import { handleHelp } from "./help/handler.js";
import { tradeDefinition } from "./trade/definition.js";
import { handleTrade } from "./trade/handler.js";
import { injectReviewDefinition } from "./inject-review/definition.js";
import { handleInjectReview } from "./inject-review/handler.js";
import { bulkReviewDefinition } from "./bulk-review/definition.js";
import { handleBulkReview } from "./bulk-review/handler.js";
import { cariDefinition } from "./cari/definition.js";
import { handleCari } from "./cari/handler.js";
import { pamerDefinition } from "./pamer/definition.js";
import { handlePamer } from "./pamer/handler.js";
import { topDefinition } from "./top/definition.js";
import { handleTop } from "./top/handler.js";
import { battleDefinition } from "./battle/definition.js";
import { handleBattle } from "./battle/handler.js";
import { listDefinition } from "./list/definition.js";
import { handleList } from "./list/handler.js";
import { giveDefinition } from "./give/definition.js";
import { handleGive, handleGiveTo } from "./give/handler.js";
import { giveToDefinition } from "./give-to/definition.js";
import {
  unwishDefinition,
  wishDefinition,
  wishlistDefinition,
} from "./wish/definition.js";
import { handleUnwish, handleWish, handleWishlist } from "./wish/handler.js";

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
  koleksiDefinition,
  helpDefinition,
  tradeDefinition,
  injectReviewDefinition,
  bulkReviewDefinition,
  cariDefinition,
  pamerDefinition,
  topDefinition,
  battleDefinition,
  listDefinition,
  wishDefinition,
  unwishDefinition,
  wishlistDefinition,
  giveDefinition,
  giveToDefinition,
];

const handlerEntries: [string, CommandHandler | CommandHandlerWithWait][] = [
  ["ping", handlePing],
  ["gacha", handleGacha],
  ["status", handleStatus],
  ["reset", handleReset],
  ["koleksi", handleKoleksi],
  ["help", handleHelp],
  ["trade", handleTrade],
  ["inject-review", handleInjectReview],
  ["bulk-review", handleBulkReview],
  ["cari", handleCari],
  ["pamer", handlePamer],
  ["top", handleTop],
  ["battle", handleBattle],
  ["list", handleList],
  ["wish", handleWish],
  ["unwish", handleUnwish],
  ["wishlist", handleWishlist],
  ["give", handleGive],
  ["give-to", handleGiveTo],
];

export const commandHandlers: Map<string, CommandHandler | CommandHandlerWithWait> =
  new Map(handlerEntries);
