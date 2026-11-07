import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    // The api function targets Deno (Deno global, npm: specifiers); it is checked by `deno check`, not tsc.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.mjs",
      "apps/debug-ui/vite.config.ts",
      "coverage/**",
      "tmp/**",
      "supabase/.temp/**",
      "supabase/functions/api/**", "**/db.types.ts",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "no-restricted-exports": ["error", { restrictDefaultExports: { direct: true } }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Stylistic rules that fight noUncheckedIndexedAccess and idiomatic React handlers; correctness rules stay on.
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  { files: ["**/*.test.ts"], rules: { "@typescript-eslint/no-non-null-assertion": "off", "@typescript-eslint/no-confusing-void-expression": "off" } },
  { files: ["*.config.{js,ts}"], rules: { "no-restricted-exports": "off" } },
);
