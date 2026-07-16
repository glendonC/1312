import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import icon from "astro-icon";

import { studioSourceResolutionPlugin } from "./scripts/vite-source-resolution-plugin.ts";

export default defineConfig({
  devToolbar: {
    enabled: false,
  },

  output: "static",
  integrations: [react(), icon()],

  // Studio client islands pull these in after first paint. Prebundle them on
  // boot so Vite never serves a half-reoptimized graph (504 Outdated Optimize Dep).
  vite: {
    plugins: [studioSourceResolutionPlugin()],
    optimizeDeps: {
      include: [
        "motion/react",
        "zustand",
        "zustand/react/shallow",
        "@xyflow/react",
      ],
    },
  },
});
