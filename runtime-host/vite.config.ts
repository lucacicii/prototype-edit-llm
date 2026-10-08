import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 4321,
    strictPort: true,
    host: '127.0.0.1',
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  },
  resolve: {
    alias: [
      { find: /^@\/style\/(.*)/, replacement: '/Users/lucas/wb/refactoring/wb-tools/packages/wb-ui/src/style/$1' },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: 'packages', replacement: path.resolve('/Users/lucas/wb/refactoring/wb-tools/packages/wb-ui/packages') },
      { find: '@wb-ui', replacement: path.resolve('/Users/lucas/wb/refactoring/wb-tools/packages/wb-ui/packages') }
    ]
  }
})
