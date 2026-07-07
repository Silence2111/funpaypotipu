import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { AssetsController } from './assets.controller';

@Global()
@Module({
  controllers: [AssetsController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
