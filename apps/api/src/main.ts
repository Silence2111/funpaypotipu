import 'reflect-metadata';
// BigInt (деньги в минорных единицах) не сериализуется в JSON штатно — отдаём строкой.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { cors: { origin: true, credentials: true } });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.listen(env.API_PORT);
  Logger.log(`🚀 API на http://localhost:${env.API_PORT}/api`, 'Bootstrap');
}

void bootstrap();
