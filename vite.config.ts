import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const apiTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${env.API_PORT || '8787'}`

  return {
    base: '/orbit-friends-universe/',
    plugins: [react()],
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
