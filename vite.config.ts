import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` must match the GitHub Pages sub-path (https://<user>.github.io/albumrankings/).
// Override with VITE_BASE=/ when deploying to a custom domain or user-root page.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/albumrankings/',
  plugins: [react(), tailwindcss()],
  server: {
    // Spotify rejects `localhost` redirect URIs under the current developer rules;
    // loopback must be registered as http://127.0.0.1:5173/callback. Bind to match.
    host: '127.0.0.1',
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
