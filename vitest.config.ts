import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@nologo/core": fileURLToPath(
        new URL("./supabase/functions/_shared/core/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "apps/**/*.test.ts",
      "supabase/functions/_shared/core/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    coverage: { include: ["supabase/functions/_shared/core/**/*.ts"], exclude: ["**/*.test.ts"] },
  },
});
