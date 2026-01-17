import { buildApp } from './app.js';
import { instagramManifest } from './manifest.js';

const port = process.env.PORT ?? 3001;

const app = buildApp();

app.listen(port, () => {
  console.log(`🚀 ${instagramManifest.name} connector listening on port ${port}`);
  console.log(`   Connector ID: ${instagramManifest.id}`);
  console.log(`   Version: ${instagramManifest.version}`);
  console.log(`   Health: http://localhost:${port}${instagramManifest.healthPath}`);
  console.log(`   Webhook: http://localhost:${port}${instagramManifest.webhookPath}`);
});
