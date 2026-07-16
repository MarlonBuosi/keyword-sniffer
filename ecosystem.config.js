// PM2 process definition. Run the production build first: `npm run build`.
// Start: `pm2 start ecosystem.config.js`  (then `pm2 save && pm2 startup`).
module.exports = {
  apps: [
    {
      name: 'wa-monitor',
      script: 'dist/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000, // back off between crash restarts
      max_memory_restart: '300M',
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-err.log',
      merge_logs: true,
      time: true, // prefix PM2 log lines with a timestamp
    },
  ],
}
