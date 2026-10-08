import { HttpStatus } from '@nestjs/common';

/** A business-rule violation that maps to an RFC 9457 problem response. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
