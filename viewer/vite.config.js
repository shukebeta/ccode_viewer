import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const viewerPort = Number.parseInt(process.env.VITE_PORT || '', 10)
const resolvedViewerPort = Number.isNaN(viewerPort) ? 6174 : viewerPort
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:6173'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: resolvedViewerPort,
    proxy: {
      '/api': apiProxyTarget
    }
  }
})
