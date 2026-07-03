import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface TopUpInput {
  orderId: string;
  amount: bigint;
  currency: string;
  account?: string;
}
export interface TopUpResult {
  providerRef: string;
  ok: boolean;
}

export interface TopUpProvider {
  readonly key: string;
  topUp(input: TopUpInput): Promise<TopUpResult>;
}

/** Тестовый провайдер пополнений (Steam/донат). В проде — реальная интеграция (docs/04). */
@Injectable()
export class MockTopUpProvider implements TopUpProvider {
  readonly key = 'mock-topup';

  async topUp(_input: TopUpInput): Promise<TopUpResult> {
    return { providerRef: `topup_${randomUUID()}`, ok: true };
  }
}
