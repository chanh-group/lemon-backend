import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// The e2e suite boots the real AppModule (get_env reads process.env), but
// neither `bun run` nor vitest injects .env into test workers — load it here.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [tsconfigPaths()],
    test: {
      globals: true,
      root: "./",
      include: ["test/e2e/**/*.e2e-spec.ts"],
      // Each spec boots a full AppModule with its own DB pool; the shared
      // Neon pooler caps total clients, so run files one at a time.
      fileParallelism: false,
      env,
      server: {
        deps: {
          inline: ["zod"],
        },
      },
    },
  };
});
