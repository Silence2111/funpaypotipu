-- Сохранённые поиски: фильтры раздела и «цена до» покупателя. Новые лоты,
-- выставленные после сохранения, приходят уведомлением; какие лоты поиск
-- уже прислал — в saved_search_hits, чтобы не повторять.

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "attrs" JSONB NOT NULL DEFAULT '{}',
    "q" VARCHAR(100),
    "max_price" BIGINT,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_hit_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_search_hits" (
    "search_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_search_hits_pkey" PRIMARY KEY ("search_id","listing_id")
);

-- CreateIndex
CREATE INDEX "saved_searches_user_id_idx" ON "saved_searches"("user_id");

-- CreateIndex
CREATE INDEX "saved_searches_category_id_idx" ON "saved_searches"("category_id");

-- CreateIndex
CREATE INDEX "saved_search_hits_listing_id_idx" ON "saved_search_hits"("listing_id");

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_search_hits" ADD CONSTRAINT "saved_search_hits_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "saved_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_search_hits" ADD CONSTRAINT "saved_search_hits_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

