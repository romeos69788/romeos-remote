import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    /** 0.0.0.0 = IPv4 σε όλα τα interfaces (κινητά στο ίδιο LAN: http://<IPv4-PC>:5174) */
    host: "0.0.0.0",
  },
});
