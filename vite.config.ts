import fs from 'fs'
import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const clientHttpsEnabled = !['0', 'false', 'no', 'off'].includes(
    String(env.CLIENT_HTTPS_ENABLED || 'false').trim().toLowerCase()
  )
  const clientHttpsPort = Number(env.CLIENT_HTTPS_PORT || 443)
  const clientHttpPort = Number(env.CLIENT_HTTP_PORT || 5173)
  const clientPreviewPort = clientHttpsEnabled ? clientHttpsPort : clientHttpPort
  const certPath = env.CLIENT_SSL_CERT_PATH ? path.resolve(env.CLIENT_SSL_CERT_PATH) : ''
  const keyPath = env.CLIENT_SSL_KEY_PATH ? path.resolve(env.CLIENT_SSL_KEY_PATH) : ''
  const keyPassphrase = env.CLIENT_SSL_KEY_PASSPHRASE || ''
  if (clientHttpsEnabled && (!certPath || !keyPath)) {
    throw new Error('CLIENT_HTTPS_ENABLED=true requires CLIENT_SSL_CERT_PATH and CLIENT_SSL_KEY_PATH')
  }

  const previewHttps =
    clientHttpsEnabled && certPath && keyPath
      ? {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
          ...(keyPassphrase ? { passphrase: keyPassphrase } : {}),
        }
      : false

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': 'http://localhost:4000',
      },
    },
    preview: {
      host: '0.0.0.0',
      port: clientPreviewPort,
      strictPort: true,
      https: previewHttps,
      proxy: {
        '/api': 'http://localhost:4000',
      },
    },
  }
})
