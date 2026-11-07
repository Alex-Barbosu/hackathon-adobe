import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The UI reads the root .env, but only exposes the two values a browser may hold. The service-role
// key and the Gemini key are never injected (check-secrets.mjs also fails the build if they leak).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env["VITE_SUPABASE_URL"] ?? env["SUPABASE_URL"] ?? ""),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(env["VITE_SUPABASE_ANON_KEY"] ?? env["SUPABASE_ANON_KEY"] ?? ""),
    },
    server: { port: 5173, open: false },
  };
});
