import { Global, Module } from '@nestjs/common';
import { ScanService } from './scan.service';

@Global()
@Module({
  providers: [ScanService],
  exports: [ScanService],
})
export class AntivirusModule {}
