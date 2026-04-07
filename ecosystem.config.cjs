module.exports = {
  apps: [
    {
      name: 'umfrage-server',
      cwd: __dirname,
      script: 'dist-server/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'umfrage-client',
      cwd: __dirname,
      script: 'node_modules/vite/bin/vite.js',
      interpreter: 'node',
      args: 'preview --host 0.0.0.0',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'umfrage-client-redirect',
      cwd: __dirname,
      script: 'scripts/client-http-redirect.mjs',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
