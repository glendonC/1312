import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import icon from "astro-icon";

export default defineConfig({
  devToolbar: {
    enabled: false,
  },

  output: "static",
  integrations: [react(), icon()],
});
