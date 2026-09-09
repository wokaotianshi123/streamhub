
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-ignore
import legacy from '@vitejs/plugin-legacy';
import { fileURLToPath, URL } from 'url';

export default defineConfig({
  // 关键修改：Electron 环境下必须使用相对路径 './'，否则加载不到资源
  base: './', 
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url))
    }
  },
  plugins: [
    react(),
    legacy({
      targets: ['android >= 4.4', 'chrome >= 30', 'ios >= 9', 'ie >= 11'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime']
    })
  ],
  build: {
    outDir: 'dist',
    target: 'es2015',
    minify: 'terser',
    rollupOptions: {
      // 强制所有代码打进单一 chunk，配合 build-inline.mjs 内联后可 file:// 直接打开
      output: {
        inlineDynamicImports: true
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000', 
        changeOrigin: true
      }
    }
  }
});
