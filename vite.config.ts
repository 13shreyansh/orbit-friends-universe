import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync } from 'node:fs'




// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const apiTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${env.API_PORT || '8787'}`




  return {
    base: '/',
    plugins: [react(), {
      name: 'preserve-demo-asset-paths',
      closeBundle() {
        // Existing photo, video and model URLs use the original project prefix.
        cpSync('public', 'dist/orbit-friends-universe', { recursive: true })
      },
    }],
    server: {
      host: env.VITE_HOST || '127.0.0.1',
      port: Number(env.VITE_PORT || 5173),
      proxy: {
        '/api': apiTarget,
        '/uploads': apiTarget,
      },
    },
    preview: {
      host: env.VITE_HOST || '127.0.0.1',
      port: Number(env.VITE_PORT || 5173),
      proxy: {
        '/api': apiTarget,
        '/uploads': apiTarget,
      },
    },
  }
})



