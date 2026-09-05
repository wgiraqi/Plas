import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ad: fileURLToPath(new URL('./ad.html', import.meta.url))
      }
    }
  }
});
