const { createTenant } = require('./tenants');

const nameIndex = process.argv.indexOf('--name');
const name = nameIndex !== -1 ? process.argv[nameIndex + 1] : null;

if (!name) {
  console.error('Usage: npm run tenant:create -- --name "Group Name"');
  process.exit(1);
}

const tenant = createTenant(name);
console.log(`Created tenant "${tenant.name}" (${tenant.tenantId}).`);
console.log('API key (shown once, store it securely):');
console.log(tenant.apiKey);
