import { describe, expect, it, beforeEach } from 'vitest';

import {
  completeCheckpoint,
  createCheckpoint,
  failCheckpoint,
  InMemoryCheckpointStore,
  parseCheckpoint,
  updateCheckpointProgress,
  type Checkpoint,
  type CheckpointKey
} from '../src/index.js';

describe('core-sync', () => {
  describe('Checkpoint', () => {
    it('parses valid checkpoint', () => {
      const data = {
        syncId: 'sync-123',
        connector: 'instagram',
        tenantId: 'tenant-1',
        resourceType: 'contacts',
        direction: 'pull',
        status: 'pending',
        processedCount: 0,
        failedCount: 0
      };
      const checkpoint = parseCheckpoint(data);
      expect(checkpoint.syncId).toBe('sync-123');
      expect(checkpoint.direction).toBe('pull');
    });

    it('throws on invalid direction', () => {
      const data = {
        syncId: 'sync-123',
        connector: 'instagram',
        tenantId: 'tenant-1',
        resourceType: 'contacts',
        direction: 'invalid',
        status: 'pending'
      };
      expect(() => parseCheckpoint(data)).toThrow();
    });

    it('applies defaults for counts', () => {
      const data = {
        syncId: 'sync-123',
        connector: 'instagram',
        tenantId: 'tenant-1',
        resourceType: 'contacts',
        direction: 'pull',
        status: 'pending'
      };
      const checkpoint = parseCheckpoint(data);
      expect(checkpoint.processedCount).toBe(0);
      expect(checkpoint.failedCount).toBe(0);
    });
  });

  describe('createCheckpoint', () => {
    it('creates checkpoint with auto-generated syncId', () => {
      const checkpoint = createCheckpoint('instagram', 'tenant-1', 'leads', 'pull');
      expect(checkpoint.connector).toBe('instagram');
      expect(checkpoint.tenantId).toBe('tenant-1');
      expect(checkpoint.resourceType).toBe('leads');
      expect(checkpoint.direction).toBe('pull');
      expect(checkpoint.status).toBe('pending');
      expect(checkpoint.syncId).toContain('instagram-tenant-1-leads');
    });

    it('creates checkpoint with custom syncId', () => {
      const checkpoint = createCheckpoint('instagram', 'tenant-1', 'leads', 'push', 'custom-sync-id');
      expect(checkpoint.syncId).toBe('custom-sync-id');
    });
  });

  describe('checkpoint state transitions', () => {
    let checkpoint: Checkpoint;

    beforeEach(() => {
      checkpoint = createCheckpoint('instagram', 'tenant-1', 'contacts', 'pull');
    });

    it('updates progress', () => {
      const updated = updateCheckpointProgress(checkpoint, {
        cursor: 'page-2',
        lastProcessedId: 'contact-100',
        processedCount: 100,
        status: 'in_progress'
      });
      expect(updated.cursor).toBe('page-2');
      expect(updated.processedCount).toBe(100);
      expect(updated.status).toBe('in_progress');
      expect(updated.lastSyncAt).toBeDefined();
    });

    it('completes checkpoint', () => {
      const completed = completeCheckpoint(checkpoint);
      expect(completed.status).toBe('completed');
      expect(completed.lastSyncAt).toBeDefined();
    });

    it('fails checkpoint', () => {
      const failed = failCheckpoint(checkpoint, 'API rate limit exceeded');
      expect(failed.status).toBe('failed');
      expect(failed.errorMessage).toBe('API rate limit exceeded');
      expect(failed.lastSyncAt).toBeDefined();
    });
  });

  describe('InMemoryCheckpointStore', () => {
    let store: InMemoryCheckpointStore;
    const key: CheckpointKey = {
      connector: 'instagram',
      tenantId: 'tenant-1',
      resourceType: 'contacts',
      direction: 'pull'
    };

    beforeEach(() => {
      store = new InMemoryCheckpointStore();
    });

    it('saves and retrieves checkpoint', async () => {
      const checkpoint = createCheckpoint(key.connector, key.tenantId, key.resourceType, key.direction);
      await store.save(checkpoint);
      const retrieved = await store.get(key);
      expect(retrieved).toEqual(checkpoint);
    });

    it('returns undefined for missing checkpoint', async () => {
      const result = await store.get(key);
      expect(result).toBeUndefined();
    });

    it('deletes checkpoint', async () => {
      const checkpoint = createCheckpoint(key.connector, key.tenantId, key.resourceType, key.direction);
      await store.save(checkpoint);
      await store.delete(key);
      const retrieved = await store.get(key);
      expect(retrieved).toBeUndefined();
    });

    it('lists checkpoints for connector/tenant', async () => {
      const checkpoint1 = createCheckpoint('instagram', 'tenant-1', 'contacts', 'pull');
      const checkpoint2 = createCheckpoint('instagram', 'tenant-1', 'leads', 'pull');
      const checkpoint3 = createCheckpoint('instagram', 'tenant-2', 'contacts', 'pull');

      await store.save(checkpoint1);
      await store.save(checkpoint2);
      await store.save(checkpoint3);

      const tenant1Checkpoints = await store.list('instagram', 'tenant-1');
      expect(tenant1Checkpoints).toHaveLength(2);

      const tenant2Checkpoints = await store.list('instagram', 'tenant-2');
      expect(tenant2Checkpoints).toHaveLength(1);
    });
  });
});
