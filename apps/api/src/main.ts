import 'reflect-metadata';
// Окружение — первым: модули ниже читают process.env при загрузке, и .env
// и очистка пустых переменных должны успеть раньше них.
import { loadEnv } from './config/env';
// BigInt (деньги в минорных единицах) не сериализуется в JSON штатно — отдаём строкой.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { corsOrigin, securityHeaders, trustProxySetting } from './common/http-security';
import { apiCompression } from './common/compression';
import { MonitoringLogger } from './modules/ops/monitoring.logger';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Content-Disposition — имя файла выгрузки (отчёты): без него сайт его не видит.
    cors: { origin: corsOrigin, credentials: true, exposedHeaders: ['Content-Disposition'] },
    // Ошибки из журнала — ещё и в сбор ошибок (часть 130).
    logger: new MonitoringLogger(),
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
