// @ts-check
import { defineConfig } from "astro/config";

// Static site: English at /, Hindi at /hi/, Bengali at /bn/.
export default defineConfig({
  site: "https://mskool.in",
  devToolbar: { enabled: false },
});
