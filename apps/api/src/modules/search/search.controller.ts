import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Полная переиндексация каталога (админ). */
  @Post('reindex')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  reindex() {
    return this.search.reindexAll();
  }
}
