import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // para poder probar desde el móvil en la misma red local
    port: 5173
  }
});
