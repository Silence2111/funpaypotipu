import 'reflect-metadata';
// BigInt (деньги в минорных единицах) не сериализуется в JSON штатно — отдаём строкой.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { corsOrigin, securityHeaders, trustProxySetting } from './common/http-security';
import { apiCompression } from './common/compression';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Content-Disposition — имя файла выгрузки (отчёты): без него сайт его не видит.
    cors: { origin: corsOrigin, credentials: true, exposedHeaders: ['Content-Disposition'] },
  });
  // Настоящий адрес покупателя за ingress — для лимитов запросов и сеансов.
  app.set('trust proxy', trustProxySetting());
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(apiCompression);
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  await app.listen(env.API_PORT);
  Logger.log(`🚀 API на http://localhost:${env.API_PORT}/api`, 'Bootstrap');
}

void bootstrap();
