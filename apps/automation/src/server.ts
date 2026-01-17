import { buildApp } from './app.js';
import { automationManifest } from './manifest.js';

const port = process.env.PORT ?? 3003;

const app = buildApp();

app.listen(port, () => {
  console.log(`⚡ ${automationManifest.name} listening on port ${port}`);
  console.log(`   Connector ID: ${automationManifest.id}`);
  console.log(`   Version: ${automationManifest.version}`);
  console.log(`   Health: http://localhost:${port}${automationManifest.healthPath}`);
  console.log(`   Webhook: http://localhost:${port}${automationManifest.webhookPath}`);
  console.log('');
  console.log('   ⚠️  This is a scaffold - iPaaS integration not yet implemented');
});
