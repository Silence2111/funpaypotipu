import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('api');
  await app.listen(env.API_PORT);
  Logger.log(`🚀 API на http://localhost:${env.API_PORT}/api`, 'Bootstrap');
}

void bootstrap();
