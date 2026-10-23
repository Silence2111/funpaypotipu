import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Валидация входящих DTO по Zod-схеме из @gamemarket/shared.
 *
 * Вход схемы — unknown: на вход приходит сырой запрос, а схема с transform
 * (например, «?status=paid,delivered» → массив) иначе не проходила по типам.
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten().fieldErrors);
    }
    return result.data;
  }
}
