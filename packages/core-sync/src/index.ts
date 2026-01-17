import { z } from 'zod';

/**
 * Sync direction: pull (from external) or push (to external).
 */
export const SyncDirectionSchema = z.enum(['pull', 'push']);
export type SyncDirection = z.infer<typeof SyncDirectionSchema>;

/**
 * Sync status for tracking progress.
 */
export const SyncStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

/**
 * Checkpoint schema for tracking sync progress.
 * Used to resume syncs from where they left off.
 */
export const CheckpointSchema = z.object({
  /** Unique sync identifier */
  syncId: z.string().min(1),

  /** Connector identifier */
  connector: z.string().min(1),

  /** Tenant identifier */
  tenantId: z.string().min(1),

  /** Resource type being synced (e.g., 'contacts', 'messages', 'leads') */
  resourceType: z.string().min(1),

  /** Direction of sync */
  direction: SyncDirectionSchema,

  /** Current status */
  status: SyncStatusSchema,

  /** Cursor/token for pagination (provider-specific) */
  cursor: z.string().optional(),

  /** Last processed item ID */
  lastProcessedId: z.string().optional(),

  /** Last sync timestamp */
  lastSyncAt: z.string().datetime().optional(),

  /** Number of items processed in current sync */
  processedCount: z.number().int().nonnegative().default(0),

  /** Number of items failed in current sync */
  failedCount: z.number().int().nonnegative().default(0),

  /** Error message if failed */
  errorMessage: z.string().optional(),

  /** Provider-specific metadata */
  meta: z.record(z.unknown()).optional()
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

/**
 * Checkpoint storage key components.
 */
export interface CheckpointKey {
  connector: string;
  tenantId: string;
  resourceType: string;
  direction: SyncDirection;
}

/**
 * Interface for checkpoint storage backends.
 */
export interface CheckpointStore {
  /** Get the latest checkpoint for a sync operation */
  get: (key: CheckpointKey) => Promise<Checkpoint | undefined>;

  /** Save a checkpoint */
  save: (checkpoint: Checkpoint) => Promise<void>;

  /** Delete a checkpoint */
  delete: (key: CheckpointKey) => Promise<void>;

  /** List all checkpoints for a connector/tenant */
  list: (connector: string, tenantId: string) => Promise<Checkpoint[]>;
}

/**
 * In-memory checkpoint store for testing and development.
 */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, Checkpoint>();

  private keyToString(key: CheckpointKey): string {
    return `${key.connector}:${key.tenantId}:${key.resourceType}:${key.direction}`;
  }

  async get(key: CheckpointKey): Promise<Checkpoint | undefined> {
    return this.store.get(this.keyToString(key));
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    const key: CheckpointKey = {
      connector: checkpoint.connector,
      tenantId: checkpoint.tenantId,
      resourceType: checkpoint.resourceType,
      direction: checkpoint.direction
    };
    this.store.set(this.keyToString(key), checkpoint);
  }

  async delete(key: CheckpointKey): Promise<void> {
    this.store.delete(this.keyToString(key));
  }

  async list(connector: string, tenantId: string): Promise<Checkpoint[]> {
    const prefix = `${connector}:${tenantId}:`;
    const results: Checkpoint[] = [];
    for (const [key, checkpoint] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        results.push(checkpoint);
      }
    }
    return results;
  }

  /** Clear all checkpoints (for testing) */
  clear(): void {
    this.store.clear();
  }
}

/**
 * Parse and validate a checkpoint.
 */
export function parseCheckpoint(data: unknown): Checkpoint {
  return CheckpointSchema.parse(data);
}

/**
 * Create a new checkpoint for starting a sync.
 */
export function createCheckpoint(
  connector: string,
  tenantId: string,
  resourceType: string,
  direction: SyncDirection,
  syncId?: string
): Checkpoint {
  return {
    syncId: syncId ?? `${connector}-${tenantId}-${resourceType}-${Date.now()}`,
    connector,
    tenantId,
    resourceType,
    direction,
    status: 'pending',
    processedCount: 0,
    failedCount: 0
  };
}

/**
 * Update checkpoint with progress.
 */
export function updateCheckpointProgress(
  checkpoint: Checkpoint,
  updates: {
    cursor?: string;
    lastProcessedId?: string;
    processedCount?: number;
    failedCount?: number;
    status?: SyncStatus;
  }
): Checkpoint {
  return {
    ...checkpoint,
    ...updates,
    lastSyncAt: new Date().toISOString()
  };
}

/**
 * Mark checkpoint as completed.
 */
export function completeCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return {
    ...checkpoint,
    status: 'completed',
    lastSyncAt: new Date().toISOString()
  };
}

/**
 * Mark checkpoint as failed.
 */
export function failCheckpoint(checkpoint: Checkpoint, errorMessage: string): Checkpoint {
  return {
    ...checkpoint,
    status: 'failed',
    errorMessage,
    lastSyncAt: new Date().toISOString()
  };
}
