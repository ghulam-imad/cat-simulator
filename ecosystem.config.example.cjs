// Copy to ecosystem.config.cjs (kept out of git: it holds the Parent PIN), then fill in `config` and `interpreter`.
// Start: npm run build && pm2 start ecosystem.config.cjs
// After pulling changes or editing `config`: npm run build && pm2 reload ecosystem.config.cjs --update-env

/** The same settings as cat-simulator.config.json (see the README's config table). */
const config = {
  "students": [
    "Aisha",
    "Omar"
  ],
  "parentPin": "change-me",
  "setsDir": "sets",
  "dbPath": "cat.sqlite",
  "port": 3000,
  "host": "0.0.0.0",
  "allowedNetworks": [
    "10.10.50.0/24"
  ]
};

module.exports = {
  apps: [
    {
      name: "cat-simulator",
      cwd: __dirname,
      script: "src/server/main.ts",
      // A fixed Node path, so pm2 still finds Node after a reboot (no shell, no version manager).
      interpreter: "node" /* better: the full path from `which node`, e.g. ~/.local/share/fnm/node-versions/v24.x/installation/bin/node */,
      interpreter_args: "--import tsx",
      env: {
        NODE_ENV: "production",
        CAT_SIMULATOR_CONFIG: JSON.stringify(config),
      },
      autorestart: true,
      restart_delay: 2000,
      time: true,
    },
  ],
};
