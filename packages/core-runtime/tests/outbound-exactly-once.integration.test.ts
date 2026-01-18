import { afterAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient, type RedisClientType } from 'redis';
import { randomUUID } from 'node:crypto';

import type { OutboundMessageIntent } from '@connectors/core-messaging';

import { processOutboundBatch } from '../src/outbound/processOutboundBatch.js';
import type { OutboundBatchResult } from '../src/outbound/types.js';
import { RedisDedupeStore, type RedisClient } from '../src/redis-dedupe-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION TEST POLICY
// ─────────────────────────────────────────────────────────────────────────────
// - Local: Skips if Docker/Podman unavailable (with warning)
// - CI: FAILS if container cannot start (gate requirement)
// ─────────────────────────────────────────────────────────────────────────────

const IS_CI = process.env.CI === 'true';
const REDIS_IMAGE = process.env.REDIS_TEST_IMAGE ?? 'redis:7-alpine';
const STARTUP_TIMEOUT_MS = 60_000;

type RedisSetup =
  | {
      ok: true;
      container: StartedTestContainer;
      url: string;
      clientA: RedisClientType;
      clientB: RedisClientType;
    }
  | { ok: false; error: Error };

const redisSetup: RedisSetup = await (async () => {
  let container: StartedTestContainer | undefined;
  let clientA: RedisClientType | undefined;
  let clientB: RedisClientType | undefined;

  try {
    container = await new GenericContainer(REDIS_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start();

    const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    clientA = createClient({ url });
    clientB = createClient({ url });
    await Promise.all([clientA.connect(), clientB.connect()]);

    return { ok: true, container, url, clientA, clientB };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await Promise.allSettled([
      clientA?.quit(),
      clientB?.quit(),
      container?.stop()
    ]);
    return { ok: false, error: err };
  }
})();

const createAdapter = (client: RedisClientType): RedisClient => ({
  set: async (key, value, mode, flag, ttlMs) => {
    if (mode !== 'NX' || flag !== 'PX') {
      throw new Error(`Unsupported Redis SET options: ${mode} ${flag}`);
    }

    return client.set(key, value, { NX: true, PX: ttlMs });
  },
  exists: (key) => client.exists(key)
});

const makeKeyPrefix = () => `test:outbound:${randomUUID()}:`;

class FakeWhatsAppClient {
  sends: OutboundMessageIntent[] = [];

  async send(intent: OutboundMessageIntent) {
    this.sends.push(intent);
    return { providerMessageId: `wamid.fake.${this.sends.length}` };
  }
}

type LogEntry = Record<string, unknown>;

const createMemoryLogger = (sink: LogEntry[]) => ({
  info: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'info', message, ...extra }),
  warn: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'warn', message, ...extra }),
  error: (message: string, extra?: Record<string, unknown>) => sink.push({ level: 'error', message, ...extra })
});

const makeIntent = (overrides: Partial<OutboundMessageIntent> = {}): OutboundMessageIntent => ({
  intentId: randomUUID(),
  tenantId: 'tenant-outbound',
  provider: 'whatsapp',
  to: '+15551234567',
  payload: { type: 'text', text: 'hello world' },
  dedupeKey: 'whatsapp:tenant-outbound:client-msg-1',
  correlationId: randomUUID(),
  createdAt: new Date().toISOString(),
  ...overrides
});

if (!redisSetup.ok) {
  if (IS_CI) {
    describe('outbound runtime exactly-once (CI gate)', () => {
      it('should start Redis container', () => {
        throw new Error(
          `Redis testcontainer failed to start in CI environment.\n` +
            `Error: ${redisSetup.error.message}\n` +
            `Ensure Docker is available and TESTCONTAINERS_RYUK_DISABLED=true is set.`
        );
      });
    });
  } else {
    console.warn(
      `⚠️  Skipping outbound exactly-once integration: ${redisSetup.error.message}\n` +
        `   To run locally with Podman:\n` +
        `   export DOCKER_HOST="unix://$XDG_RUNTIME_DIR/podman/podman.sock"\n` +
        `   export TESTCONTAINERS_RYUK_DISABLED=true\n` +
        `   systemctl --user enable --now podman.socket`
    );
    describe.skip('outbound runtime exactly-once (skipped: container unavailable)', () => {
      it('skipped', () => {});
    });
  }
} else {
  describe('outbound runtime exactly-once (redis)', () => {
    afterAll(async () => {
      await Promise.allSettled([redisSetup.clientA.quit(), redisSetup.clientB.quit()]);
      await redisSetup.container.stop();
    });

    it('dedupes across instances and logs per item', async () => {
      const keyPrefix = makeKeyPrefix();
      const storeA = new RedisDedupeStore({ client: createAdapter(redisSetup.clientA), keyPrefix, failMode: 'open' });
      const storeB = new RedisDedupeStore({ client: createAdapter(redisSetup.clientB), keyPrefix, failMode: 'open' });

      const fakeClient = new FakeWhatsAppClient();
      const logs: LogEntry[] = [];
      const logger = createMemoryLogger(logs);

      const intent = makeIntent();

      const [resultA, resultB]: [OutboundBatchResult, OutboundBatchResult] = await Promise.all([
        processOutboundBatch([intent], (i) => fakeClient.send(i), { dedupeStore: storeA, logger }),
        processOutboundBatch([intent], (i) => fakeClient.send(i), { dedupeStore: storeB, logger })
      ]);

      expect(fakeClient.sends).toHaveLength(1);
      expect(fakeClient.sends[0]?.dedupeKey).toBe(intent.dedupeKey);

      expect(resultA.summary.total).toBe(1);
      expect(resultB.summary.total).toBe(1);
      expect(resultA.summary.deduped + resultB.summary.deduped).toBe(1);
      expect(resultA.summary.sent + resultB.summary.sent).toBe(1);

      const itemLogs = logs.filter((entry) => entry.event === 'outbound_process_item');
      expect(itemLogs.length).toBeGreaterThan(0);
      const hasCorrelation = itemLogs.some((entry) => entry.correlationId === intent.correlationId);
      const hasDedupeKey = itemLogs.some((entry) => entry.dedupeKey === intent.dedupeKey);
      const hasStatuses = itemLogs.some((entry) => entry.status === 'sent') && itemLogs.some((entry) => entry.status === 'deduped');

      expect(hasCorrelation).toBe(true);
      expect(hasDedupeKey).toBe(true);
      expect(hasStatuses).toBe(true);
    });
  });
}
