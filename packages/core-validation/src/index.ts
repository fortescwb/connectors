import type { ZodIssue, ZodTypeAny } from 'zod';

export class ValidationError extends Error {
  public readonly issues: ZodIssue[];
  public readonly context?: string;

  constructor(message: string, issues: ZodIssue[], context?: string) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
    this.context = context;
  }
}

export function safeParseOrThrow<Schema extends ZodTypeAny>(
  schema: Schema,
  data: unknown,
  context?: string
): ReturnType<Schema['parse']> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issueSummary = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    const message = context ? `${context}: ${issueSummary}` : issueSummary;
    throw new ValidationError(message || 'Validation failed', result.error.issues, context);
  }

  return result.data;
}
