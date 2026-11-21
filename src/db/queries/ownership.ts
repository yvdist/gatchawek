import { eq } from "drizzle-orm";

import type { Db } from "../client.js";
import { userCards } from "../schema.js";

/**
 * Read-only ownership adapter over the legacy gacha tables (spec 02 §2).
 * A game card is owned when the same user owns the collection card that
 * `game_cards.source_card_id` points at; no view, no writes.
 * One indexed read on the `user_cards` primary key: the D1 free tier bills
 * rows read, so this intentionally joins nothing.
 */
export interface OwnedCard {
  /** Collection card id (`cards.id`). */
  cardId: string;
  quantity: number;
  holoQty: number;
}

export async function getOwnedCards(db: Db, userId: string): Promise<OwnedCard[]> {
  return db
    .select({
      cardId: userCards.cardId,
      quantity: userCards.quantity,
      holoQty: userCards.holoQty,
    })
    .from(userCards)
    .where(eq(userCards.userId, userId));
}
