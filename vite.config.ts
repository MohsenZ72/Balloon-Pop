import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Camera access requires a secure context. `localhost` works out of the box.
// For testing on a phone over LAN, add HTTPS, e.g. with @vitejs/plugin-basic-ssl:
//   npm i -D @vitejs/plugin-basic-ssl
//   import basicSsl from '@vitejs/plugin-basic-ssl'
//   plugins: [react(), basicSsl()]
export default defineConfig({
  // GitHub Pages project site: https://mohsenz72.github.io/Balloon-Pop/
  base: '/Balloon-Pop/',
  plugins: [react()],
})
