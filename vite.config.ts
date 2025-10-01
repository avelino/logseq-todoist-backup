import { defineConfig } from "vite";
import logseqDevPlugin from "vite-plugin-logseq";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [logseqDevPlugin()],
  build: {
    target: "esnext",
    minify: "esbuild",
  },
});
