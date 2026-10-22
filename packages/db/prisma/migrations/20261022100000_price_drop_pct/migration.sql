-- Насколько снижена цена — для сортировки «Сначала большие снижения» и
-- «−12%» у отметки «минимум за 30 дней». У скидки — как её пометка «−N%»
-- (от честной прежней цены, saleOff в packages/shared/src/sale.ts), у
-- отметки — от price_low_ref: самой низкой цены за 30 дней до первого из
-- снижений подряд. Пока цена только снижалась, она правда снижена с неё;
-- любое повышение цепочку обрывает. Ставит тот же триггер, что отметку;
-- истёкшую отметку снимает фоновая задача скидок.

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "price_drop_pct" SMALLINT,
ADD COLUMN     "price_low_ref" BIGINT;

CREATE OR REPLACE FUNCTION listing_price_low() RETURNS trigger AS $$
DECLARE
  at_now TIMESTAMP(3) := now() AT TIME ZONE 'UTC';
  since TIMESTAMP(3) := at_now - interval '30 days';
  prev_low BIGINT;
  sale_ref BIGINT := COALESCE(NEW.sale_ref_price, NEW.sale_list_price);
BEGIN
  IF NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.price_per_units IS NOT DISTINCT FROM OLD.price_per_units THEN
    RETURN NEW;
  END IF;
  -- У пополнения цена «от» следует из наценки, а не из снижений.
  IF NEW.topup_markup_bps IS NOT NULL THEN
    NEW.price_low_until := NULL;
    NEW.price_low_ref := NULL;
    NEW.price_drop_pct := NULL;
    RETURN NEW;
  END IF;
  -- Самая низкая цена за 30 дней: та, что действовала на их начало, и все
  -- смены после — в нынешней пачке лота, как на графике истории цены.
  SELECT min((p.price * NEW.price_per_units + p.price_per_units / 2) / p.price_per_units)
    INTO prev_low
    FROM (
      (SELECT price, price_per_units FROM listing_price_points
        WHERE listing_id = NEW.id AND at < since
        ORDER BY at DESC, id DESC LIMIT 1)
      UNION ALL
      (SELECT price, price_per_units FROM listing_price_points
        WHERE listing_id = NEW.id AND at >= since)
    ) p;
  IF prev_low IS NOT NULL AND NEW.price < prev_low
     AND (OLD.price_low_until > at_now OR NEW.price * 100 <= prev_low * (100 - 5)) THEN
    -- Снижение следом — от той же цены, с которой начали снижать.
    NEW.price_low_ref := CASE
      WHEN OLD.price_low_until > at_now AND OLD.price_low_ref IS NOT NULL
        AND NEW.price_per_units = OLD.price_per_units THEN OLD.price_low_ref
      ELSE prev_low END;
    NEW.price_low_until := at_now + interval '30 days';
    NEW.price_drop_pct := round(((NEW.price_low_ref - NEW.price) * 1000 / NEW.price_low_ref)::numeric / 10);
  ELSE
    NEW.price_low_until := NULL;
    NEW.price_low_ref := NULL;
    NEW.price_drop_pct := NULL;
  END IF;
  -- Идёт скидка — снижение то, что видит покупатель: её «−N%».
  IF NEW.sale_until IS NOT NULL AND sale_ref > NEW.price THEN
    NEW.price_drop_pct := round(((sale_ref - NEW.price) * 1000 / sale_ref)::numeric / 10);
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Идущим скидкам — их «−N%».
UPDATE listings
SET price_drop_pct = round(((COALESCE(sale_ref_price, sale_list_price) - price) * 1000
  / COALESCE(sale_ref_price, sale_list_price))::numeric / 10)
WHERE sale_until IS NOT NULL AND COALESCE(sale_ref_price, sale_list_price) > price;
