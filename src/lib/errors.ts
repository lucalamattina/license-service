export type ErrorCode =
  | 'validation_error'
  | 'expires_at_in_past'
  | 'not_found'
  | 'duplicate_email'
  | 'duplicate_active_license'
  | 'license_not_active'
  | 'internal_error';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static validationError(message: string, details?: unknown): ApiError {
    return new ApiError('validation_error', 400, message, details);
  }

  static expiresAtInPast(message: string): ApiError {
    return new ApiError('expires_at_in_past', 400, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError('not_found', 404, message);
  }

  static duplicateEmail(message: string): ApiError {
    return new ApiError('duplicate_email', 409, message);
  }

  static duplicateActiveLicense(message: string): ApiError {
    return new ApiError('duplicate_active_license', 409, message);
  }

  static licenseNotActive(message: string): ApiError {
    return new ApiError('license_not_active', 409, message);
  }

  static internalError(message: string): ApiError {
    return new ApiError('internal_error', 500, message);
  }
}
