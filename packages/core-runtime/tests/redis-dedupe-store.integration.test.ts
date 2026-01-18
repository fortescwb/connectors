import { afterAll, describe, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createClient, type RedisClientType } from 'redis';
import { randomUUID } from 'node:crypto';

import { RedisDedupeStore, type RedisClient } from '../src/redis-dedupe-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION TEST POLICY
// ─────────────────────────────────────────────────────────────────────────────
// - Local: Skips if Docker/Podman unavailable (with warning)
// - CI: FAILS if container cannot start (gate requirement)
//
// Required environment for Podman:
//   export DOCKER_HOST="unix://$XDG_RUNTIME_DIR/podman/podman.sock"
//   export TESTCONTAINERS_RYUK_DISABLED=true
//   systemctl --user enable --now podman.socket
// ─────────────────────────────────────────────────────────────────────────────

const IS_CI = process.env.CI === 'true';

type RedisSetup =
  | {
      ok: true;
      container: StartedTestContainer;
      url: string;
      clientA: RedisClientType;
      clientB: RedisClientType;
    }
  | { ok: false; error: Error };

const REDIS_IMAGE = process.env.REDIS_TEST_IMAGE ?? 'redis:7-alpine';
const STARTUP_TIMEOUT_MS = 60_000;

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

const makeKeyPrefix = () => `test:dedupe:${randomUUID()}:`;

if (!redisSetup.ok) {
  // In CI, fail hard - integration tests are mandatory
  if (IS_CI) {
    describe('RedisDedupeStore integration', () => {
      it('should start Redis container (CI gate)', () => {
        throw new Error(
          `Redis testcontainer failed to start in CI environment.\n` +
            `Error: ${redisSetup.error.message}\n` +
            `Ensure Docker is available and TESTCONTAINERS_RYUK_DISABLED=true is set.`
        );
      });
    });
  } else {
    // Local dev: skip with warning
    console.warn(
      `⚠️  Skipping Redis integration tests: ${redisSetup.error.message}\n` +
        `   To run locally with Podman:\n` +
        `   export DOCKER_HOST="unix://$XDG_RUNTIME_DIR/podman/podman.sock"\n` +
        `   export TESTCONTAINERS_RYUK_DISABLED=true\n` +
        `   systemctl --user enable --now podman.socket`
    );
    describe.skip('RedisDedupeStore integration (skipped: container unavailable)', () => {
      it('skipped: redis unavailable for integration tests', () => {});
    });
  }
} else {
  describe('RedisDedupeStore integration', () => {
    afterAll(async () => {
      await Promise.allSettled([redisSetup.clientA.quit(), redisSetup.clientB.quit()]);
      await redisSetup.container.stop();
    });

    it('cross-instance dedupe', async () => {
      const keyPrefix = makeKeyPrefix();
      const storeA = new RedisDedupeStore({
        client: createAdapter(redisSetup.clientA),
        keyPrefix
      });
      const storeB = new RedisDedupeStore({
        client: createAdapter(redisSetup.clientB),
        keyPrefix
      });

      const first = await storeA.checkAndMark('event-1', 30_000);
      const second = await storeB.checkAndMark('event-1', 30_000);

      expect(first).toBe(false);
      expect(second).toBe(true);
    });

    it('ttl expiry', async () => {
      const keyPrefix = makeKeyPrefix();
      const store = new RedisDedupeStore({
        client: createAdapter(redisSetup.clientA),
        keyPrefix
      });

      const ttlMs = 500;
      const first = await store.checkAndMark('event-ttl', ttlMs);

      expect(first).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, ttlMs + 300));

      const second = await store.checkAndMark('event-ttl', ttlMs);

      expect(second).toBe(false);
    });

    it('fail mode open vs closed when client disconnected', async () => {
      const rawClient = createClient({ url: redisSetup.url });
      await rawClient.connect();
      await rawClient.quit();

      const client = createAdapter(rawClient);
      const keyPrefix = makeKeyPrefix();

      const openStore = new RedisDedupeStore({
        client,
        keyPrefix,
        failMode: 'open'
      });
      const closedStore = new RedisDedupeStore({
        client,
        keyPrefix,
        failMode: 'closed'
      });

      const openResult = await openStore.checkAndMark('event-fail-open', 1000);
      const closedResult = await closedStore.checkAndMark('event-fail-closed', 1000);

      expect(openResult).toBe(true);
      expect(closedResult).toBe(false);
    });
  });
}
