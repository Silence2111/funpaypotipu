import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/** Валидация входящих DTO по Zod-схеме из @gamemarket/shared. */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten().fieldErrors);
    }
    return result.data;
  }
}
