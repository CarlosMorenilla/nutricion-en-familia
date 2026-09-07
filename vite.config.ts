import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';
// A static React build runs on Cloudflare Pages Free; Supabase owns auth and data.
export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: 'dist/client' },
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
});
