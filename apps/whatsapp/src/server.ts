import { createLogger } from '@connectors/core-logging';

import { buildApp } from './app.js';

const logger = createLogger({ service: 'whatsapp-app' });
const port = Number(process.env.PORT ?? 3000);

const app = await buildApp();

app.listen(port, () => {
  logger.info(`WhatsApp connector listening on port ${port}`);
});
