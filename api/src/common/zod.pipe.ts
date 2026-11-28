import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates a body, query or param with a Zod schema. Usage: @Body(new ZodPipe(Schema)) */
export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): T['_output'] {
    return parse(this.schema, value);
  }
}

export function parse<T extends ZodType>(schema: T, value: unknown): T['_output'] {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`),
    );
  }
  return result.data;
}
