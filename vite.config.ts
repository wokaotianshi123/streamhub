
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      // 这里的配置确保本地开发时调用 /api/proxy 也能转发到后端或模拟服务
      '/api': {
        target: 'http://localhost:3000', 
        changeOrigin: true
      }
    }
  }
});