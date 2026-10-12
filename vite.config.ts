import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/api": "http://localhost:4000",
      "/socket.io": { target: "http://localhost:4000", ws: true },
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
