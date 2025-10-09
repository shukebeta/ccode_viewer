import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 6174,
    proxy: {
      '/api': 'http://localhost:6173'
    }
  }
})
