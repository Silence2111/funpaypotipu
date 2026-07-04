import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MeiliSearch, type Index } from 'meilisearch';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

const INDEX = 'listings';

interface ListingDoc {
  id: string;
  title: string;
  description: string;
  gameSlug: string;
  categorySlug: string;
  status: string;
  price: number;
  currency: string;
  createdAt: number;
}

export interface SearchFilters {
  gameSlug?: string;
  categorySlug?: string;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Выделенный поиск на Meilisearch (typo-tolerance, релевантность, фасеты).
 * Если MEILI_URL не задан или движок недоступен — тихий fallback на Postgres
 * (см. ListingsService.browse). docs/07.
 */
@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private client: MeiliSearch | null = null;
  private index: Index<ListingDoc> | null = null;

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {
    const host = process.env.MEILI_URL;
    if (host) this.client = new MeiliSearch({ host, apiKey: process.env.MEILI_MASTER_KEY });
  }

  get enabled(): boolean {
    return this.index !== null;
  }

  async onModuleInit() {
    if (!this.client) return;
    try {
      await this.client.createIndex(INDEX, { primaryKey: 'id' }).catch(() => undefined);
      const index = this.client.index<ListingDoc>(INDEX);
      await index.updateSettings({
        searchableAttributes: ['title', 'description'],
        filterableAttributes: ['gameSlug', 'categorySlug', 'status', 'price'],
        sortableAttributes: ['price', 'createdAt'],
      });
      this.index = index;
      const { indexed } = await this.reindexAll();
      this.logger.log(`Meilisearch подключён, проиндексировано лотов: ${indexed}`);
    } catch (e) {
      this.client = null;
      this.index = null;
      this.logger.warn(`Meilisearch недоступен, поиск на Postgres: ${(e as Error).message}`);
    }
  }

  async indexListing(id: string): Promise<void> {
    if (!this.index) return;
    const l = await this.prisma.listing.findUnique({
      where: { id },
      include: { game: true, category: true },
    });
    if (!l) return;
    if (l.status !== 'active') {
      await this.index.deleteDocument(id).catch(() => undefined);
      return;
    }
    await this.index.addDocuments([this.toDoc(l)]);
  }

  async removeListing(id: string): Promise<void> {
    if (this.index) await this.index.deleteDocument(id).catch(() => undefined);
  }

  /** id лотов в порядке релевантности + оценка общего числа. null → движок недоступен. */
  async searchIds(
    q: string,
    filters: SearchFilters,
    limit: number,
    offset: number,
  ): Promise<{ ids: string[]; total: number } | null> {
    if (!this.index) return null;
    const filter: string[] = ['status = active'];
    if (filters.gameSlug) filter.push(`gameSlug = "${filters.gameSlug}"`);
    if (filters.categorySlug) filter.push(`categorySlug = "${filters.categorySlug}"`);
    if (filters.minPrice != null) filter.push(`price >= ${filters.minPrice}`);
    if (filters.maxPrice != null) filter.push(`price <= ${filters.maxPrice}`);

    const res = await this.index.search(q, { filter, limit, offset, attributesToRetrieve: ['id'] });
    return { ids: res.hits.map((h) => h.id), total: res.estimatedTotalHits ?? res.hits.length };
  }

  async reindexAll(): Promise<{ indexed: number }> {
    if (!this.index) return { indexed: 0 };
    const listings = await this.prisma.listing.findMany({
      where: { status: 'active' },
      include: { game: true, category: true },
    });
    const docs = listings.map((l) => this.toDoc(l));
    if (docs.length) await this.index.addDocuments(docs);
    return { indexed: docs.length };
  }

  private toDoc(l: {
    id: string; title: string; description: string; status: string; price: bigint; currency: string;
    createdAt: Date; game: { slug: string }; category: { slug: string };
  }): ListingDoc {
    return {
      id: l.id,
      title: l.title,
      description: l.description,
      gameSlug: l.game.slug,
      categorySlug: l.category.slug,
      status: l.status,
      price: Number(l.price),
      currency: l.currency,
      createdAt: l.createdAt.getTime(),
    };
  }
}
