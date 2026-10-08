import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Parses and strips input with a shared zod schema; ZodError is rendered by ProblemDetailsFilter. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
