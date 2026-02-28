import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/web',
  build: {
    outDir: '../../out/web',
    emptyOutDir: true
  },
  plugins: [react(), tailwindcss()]
})
