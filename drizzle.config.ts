import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // One database, one migration folder: legacy bot schema + additive game schema.
  schema: ["./src/db/schema.ts", "./src/db/schema-game.ts"],
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
});
