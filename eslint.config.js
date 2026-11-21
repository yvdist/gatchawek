import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/",
      ".wrangler/",
      "coverage/",
      ".claude/",
      "games/adu-batang/dist/",
      "games/adu-batang/.wrangler/",
      "games/adu-batang/worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  tseslint.configs.disableTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Golden rule 1: the engine stays pure. No Cloudflare, DOM, React or IO deps.
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*"], message: "Engine must stay pure: no Node builtins." },
            { group: ["hono", "hono/*"], message: "Engine must stay pure: no Hono." },
            { group: ["react", "react-dom", "react/*", "react-dom/*"], message: "Engine must stay pure: no DOM/React." },
            { group: ["@cloudflare/*"], message: "Engine must stay pure: no Cloudflare APIs." },
            { group: ["@sentry/*"], message: "Engine must stay pure: no telemetry SDK." },
            { group: ["drizzle-orm", "drizzle-orm/*"], message: "Engine must stay pure: no database access." },
          ],
        },
      ],
    },
  },
];
