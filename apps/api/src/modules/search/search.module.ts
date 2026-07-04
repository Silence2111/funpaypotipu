import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
