const { paths, app } = require('./config');
const { runCheckForTenant } = require('./checkRunner');

const forceEmail = process.argv.includes('--force-email');

runCheckForTenant({ paths, config: app, forceEmail }).catch(() => {
  process.exit(1);
});
