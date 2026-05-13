import { ZodError } from 'zod';
import { ApiError, type ErrorCode } from './errors.js';

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  details?: unknown;
}

export interface MappedError {
  status: number;
  body: ErrorBody;
}

interface ZodFieldIssue {
  path: ReadonlyArray<PropertyKey>;
  message: string;
  code: string;
}

function mapZodIssues(err: ZodError): ZodFieldIssue[] {
  return err.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
  }));
}

export function mapErrorToResponse(err: unknown): MappedError {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: {
        error: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: 'validation_error',
        message: 'Request validation failed',
        details: mapZodIssues(err),
      },
    };
  }

  return {
    status: 500,
    body: {
      error: 'internal_error',
      message: 'An unexpected error occurred',
    },
  };
}
