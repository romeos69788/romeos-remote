import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** GitHub Pages project site: https://<user>.github.io/romeos-remote/ */
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    /** 0.0.0.0 = IPv4 σε όλα τα interfaces (κινητά στο ίδιο LAN: http://<IPv4-PC>:5174) */
    host: "0.0.0.0",
  },
});
