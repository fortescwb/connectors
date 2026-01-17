import { buildApp } from './app.js';
import { calendarManifest } from './manifest.js';

const port = process.env.PORT ?? 3002;

const app = buildApp();

app.listen(port, () => {
  console.log(`🗓️  ${calendarManifest.name} listening on port ${port}`);
  console.log(`   Connector ID: ${calendarManifest.id}`);
  console.log(`   Version: ${calendarManifest.version}`);
  console.log(`   Health: http://localhost:${port}${calendarManifest.healthPath}`);
  console.log(`   Webhook: http://localhost:${port}${calendarManifest.webhookPath}`);
  console.log('');
  console.log('   ⚠️  This is a scaffold - calendar integration not yet implemented');
});
