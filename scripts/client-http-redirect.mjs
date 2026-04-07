import 'dotenv/config'
import http from 'http'

const enabled = !['0', 'false', 'no', 'off'].includes(
  String(process.env.CLIENT_HTTP_REDIRECT_ENABLED || 'false').trim().toLowerCase()
)

if (!enabled) {
  console.log('Client HTTP redirect disabled (CLIENT_HTTP_REDIRECT_ENABLED=false).')
  setInterval(() => {}, 60_000)
}
if (enabled) {
  const httpPort = Number(process.env.CLIENT_HTTP_PORT || 80)
  const httpsPort = Number(process.env.CLIENT_HTTPS_PORT || 443)

  http
    .createServer((req, res) => {
      const hostHeader = req.headers.host || ''
      const hostOnly = hostHeader.split(':')[0] || 'localhost'
      const target = `https://${hostOnly}:${httpsPort}${req.url || '/'}`
      res.writeHead(301, { Location: target })
      res.end()
    })
    .listen(httpPort, '0.0.0.0', () => {
      console.log(`Client redirect listening on http://0.0.0.0:${httpPort} -> https://0.0.0.0:${httpsPort}`)
    })
}
