import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["node_modules/", ".wrangler/", "coverage/", ".claude/"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  tseslint.configs.disableTypeChecked,
  {
    files: ["**/*.ts"],
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
];
