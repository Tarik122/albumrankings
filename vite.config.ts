import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` must match the GitHub Pages sub-path (https://<user>.github.io/albumrankings/).
// Override with VITE_BASE=/ when deploying to a custom domain or user-root page.
export default defineConfig({
  base: process.env.VITE_BASE || '/albumrankings/',
  plugins: [react(), tailwindcss()],
  server: {
    // Spotify rejects `localhost` redirect URIs under the current developer rules,
    // so the dev redirect URI must be http://127.0.0.1:5173/albumrankings/ — which
    // means the dev server has to bind to the loopback IP, not the hostname.
    host: '127.0.0.1',
    port: 5173,
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Node by default, for the rating maths. Component tests opt into jsdom
    // with a `@vitest-environment jsdom` docblock.
    environment: 'node',
  },
})
