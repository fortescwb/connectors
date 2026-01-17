import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { safeParseOrThrow, ValidationError } from '../src/index.js';

describe('safeParseOrThrow', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number().int().positive().optional()
  });

  it('returns parsed data when valid', () => {
    const data = { name: 'Ada Lovelace', age: 36 };
    const parsed = safeParseOrThrow(schema, data, 'person');
    expect(parsed).toEqual(data);
  });

  it('throws ValidationError with context when invalid', () => {
    const invalid = { age: -1 };
    expect(() => safeParseOrThrow(schema, invalid, 'person')).toThrow(ValidationError);
    try {
      safeParseOrThrow(schema, invalid, 'person');
    } catch (error) {
      const err = error as ValidationError;
      expect(err.message).toContain('person');
      expect(err.issues).toBeDefined();
      expect(err.issues[0]?.path).toEqual(['name']);
    }
  });
});
