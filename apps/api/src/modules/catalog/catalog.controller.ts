import { Controller, Get, Param } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('games')
  games() {
    return this.catalog.listGames();
  }

  @Get('games/:slug')
  game(@Param('slug') slug: string) {
    return this.catalog.getGameBySlug(slug);
  }

  @Get('categories/:id/attributes')
  attributes(@Param('id') id: string) {
    return this.catalog.getCategoryAttributes(id);
  }
}
