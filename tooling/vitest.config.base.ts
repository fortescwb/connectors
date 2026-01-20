import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const workspaceRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const resolveAlias = {
  '@connectors/core-events': path.join(workspaceRoot, 'packages/core-events/src/index.ts'),
  '@connectors/core-validation': path.join(workspaceRoot, 'packages/core-validation/src/index.ts'),
  '@connectors/core-tenant': path.join(workspaceRoot, 'packages/core-tenant/src/index.ts'),
  '@connectors/core-logging': path.join(workspaceRoot, 'packages/core-logging/src/index.ts'),
  '@connectors/core-webhooks': path.join(workspaceRoot, 'packages/core-webhooks/src/index.ts'),
  '@connectors/core-signature': path.join(workspaceRoot, 'packages/core-signature/src/index.ts'),
  '@connectors/core-runtime': path.join(workspaceRoot, 'packages/core-runtime/src/index.ts'),
  '@connectors/core-connectors': path.join(workspaceRoot, 'packages/core-connectors/src/index.ts'),
  '@connectors/adapter-express': path.join(workspaceRoot, 'packages/adapter-express/src/index.ts'),
  '@connectors/core-messaging': path.join(workspaceRoot, 'packages/core-messaging/src/index.ts'),
  '@connectors/core-meta-whatsapp': path.join(workspaceRoot, 'packages/core-meta-whatsapp/src/index.ts')
};

export default defineConfig({
  resolve: {
    alias: resolveAlias
  },
  test: {
    environment: 'node',
    globals: true,
    reporters: ['default'],
    coverage: {
      reporter: ['text', 'lcov'],
      exclude: ['**/tests/**', '**/*.d.ts']
    }
  }
});
