import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { spotifyProxy } from './server/spotify';
import { loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  // These values are used only by the Node middleware. Never place them in
  // Vite's public `define`, client env, or the generated browser bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [react(), tailwindcss(), spotifyProxy({ env: {
    SPOTIFY_CLIENT_ID: env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: env.SPOTIFY_CLIENT_SECRET,
    SPOTIFY_ALLOWED_ORIGINS: env.SPOTIFY_ALLOWED_ORIGINS,
  } })], test: { environment: 'node', include: ['src/**/*.test.ts'] } };
});
