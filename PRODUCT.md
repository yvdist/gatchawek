# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner of the gatchawek Discord bot, working alone at a laptop or desktop. They use the admin panel to curate the card catalog that the bot's players pull from. Phone use is occasional. No other admins or moderators share the panel.

## Product Purpose

The admin panel at `/admin` is the owner's back office for the card catalog behind the gatchawek photocard gacha bot. It lets the owner:

- see catalog health at a glance: total cards, cards with no image, and cards still on a raw remote image;
- browse and search cards, filtered by image state (`empty`, `remote`, `static`);
- fix one card: replace its image by upload (through Discord) or manual https URL, or turn it on or off;
- request a cloud render of raw remote cards into framed card art (GitHub Actions, at most 50 per request);
- review community inject submissions from Discord and approve or reject them, using the same logic as the Discord buttons;
- bulk import new cards by dragging images in, with pool, group, name and rarity parsed from the file name.

Success means the catalog stays complete and correct with little effort. The owner can see which cards need work, which are final, and act on them without touching the command line.

## Operating Context

- The bot runs in a private Discord server of about 10 people. Players pull cards with slash commands such as `/gacha`, `/koleksi` and `/trade`. The panel is never seen by players.
- Card hierarchy: Pool → Group → Member → Card. One card is one photo with a `photoNo` and a `serial`. Current pools are Pejabat, Jomok and Ahli Ngebul, and more can be added from data without code changes.
- Rarity has six fixed tiers and colors: common ★ `#9CA3AF`, rare ★★ `#A855F7`, super rare ★★★ `#F59E0B`, ultra rare ★★★★ `#EC4899`, holo ★★★★★ `#FFD700`, secret ★★★★★★ `#22D3EE`. Source: `src/domain/rarity.ts`.
- A card's image is in one of three states:
  - **static**: a rendered, framed 600×900 card from the build pipeline;
  - **remote**: a raw CDN or Discord photo that is not rendered yet;
  - **empty**: no image.

  The rendered versus not-rendered distinction is central to the owner's work.
- Import file name pattern: `(rarity) - nama grup - nama kartu.ext`, with rarity aliases such as `c/1`, `sr/3` and `s/6`.
- The interface language is Indonesian.

## Capabilities and Constraints

- The stack is fixed: Cloudflare Workers + Hono + D1 (Drizzle). Pages are server-rendered HTML strings from pure builder functions in `src/ui/adminHtml.ts`, with small inline vanilla scripts. There is no client framework and no build step for the UI.
- Pico CSS v2 is loaded from jsDelivr as a base and overridden by the inline admin stylesheet.
- Auth is a single password with an HttpOnly, SameSite=Lax, Secure cookie. All mutations are POST-only.
- All database and user values must go through `escapeHtml`. Pool and group names must never be hardcoded in UI logic; they come from the database.
- Remote render is disabled for the `pejabat` pool, which is excluded from permanent renders.
- Lists load at most 100 rows and have no pagination yet.
- The project runs on the free tier, so no paid services are used.

## Brand Commitments

- The name is "gatchawek", and the panel is labeled "Admin".
- Card art and rarity colors come from the bot itself. The panel shows the real rendered cards and must not restyle or reinterpret them.
- Text on cards is only the person's name, never captions or jokes. This is a policy against defamation risk, so the panel must not add commentary to cards.

## Evidence on Hand

- Rendered cards are served from `https://<PUBLIC_BASE_URL>/cards/<file>`. Raw images are on Discord or other CDNs.
- There are no screenshots, metrics or user research for the panel itself. Do not invent usage numbers.

## Product Principles

1. **Show the card, not a row about the card.** The owner thinks in cards, so card imagery is the primary way to scan.
2. **Make "needs work" obvious.** Rendered, raw and empty cards must be impossible to confuse at a glance.
3. **One owner, no ceremony.** Optimize for speed and clarity for a single expert user. Skip onboarding, roles and marketing copy.
4. **Same truth as Discord.** Actions on the panel use the same logic as the bot's Discord buttons and never fork behavior.
5. **Data-driven growth.** New pools, groups and rarities in data must show up without UI changes.
