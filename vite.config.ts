import { defineConfig, type Plugin } from "vite";
import logseqDevPluginImport from "vite-plugin-logseq";

const resolveLogseqPlugin = (maybePlugin: unknown): (() => Plugin) => {
  if (typeof maybePlugin === "function") {
    return maybePlugin;
  }

  const namespace = maybePlugin as { default?: unknown } | undefined;
  if (namespace?.default && typeof namespace.default === "function") {
    return namespace.default as () => Plugin;
  }

  throw new TypeError("vite-plugin-logseq did not export a plugin factory");
};

const logseqDevPlugin = resolveLogseqPlugin(logseqDevPluginImport);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [logseqDevPlugin()],
  build: {
    target: "esnext",
    minify: "esbuild",
  },
});
