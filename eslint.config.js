import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    // The api function targets Deno (Deno global, npm: specifiers); it is checked by `deno check`, not tsc.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "coverage/**",
      "tmp/**",
      "supabase/.temp/**",
      "supabase/functions/api/**",
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
    },
  },
  { files: ["*.config.{js,ts}"], rules: { "no-restricted-exports": "off" } },
);
