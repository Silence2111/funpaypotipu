-- Отметка «минимум за 30 дней». Цена опустилась хотя бы на 5% ниже самой
-- низкой цены лота за 30 дней до этого — лот помечен на 30 дней с момента
-- снижения: всё это время цена ниже любой, что была за последние 30 дней.
-- Снижение следом отметку продлевает без нового порога; повышение, возврат
-- к прежней цене или смена на такую же — снимают. Подъём на день и возврат
-- отметки не дают: прежняя цена не ниже самой себя.
--
-- Считает триггер базы, как и историю цены: любым путём — правка, массовая
-- правка, скидка и её возврат по сроку одним запросом. Числа те же, что
-- PRICE_LOW_DAYS и PRICE_LOW_MIN_PCT в packages/shared/src/price-history.ts.

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "price_low_until" TIMESTAMP(3);

-- Триггер до записи: точки истории ещё без новой цены — все они прежние.
CREATE FUNCTION listing_price_low() RETURNS trigger AS $$
DECLARE
  at_now TIMESTAMP(3) := now() AT TIME ZONE 'UTC';
  since TIMESTAMP(3) := at_now - interval '30 days';
  prev_low BIGINT;
BEGIN
  IF NEW.price IS NOT DISTINCT FROM OLD.price
     AND NEW.price_per_units IS NOT DISTINCT FROM OLD.price_per_units THEN
    RETURN NEW;
  END IF;
  -- У пополнения цена «от» следует из наценки, а не из снижений.
  IF NEW.topup_markup_bps IS NOT NULL THEN
    NEW.price_low_until := NULL;
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
    NEW.price_low_until := at_now + interval '30 days';
  ELSE
    NEW.price_low_until := NULL;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER listings_price_low
BEFORE UPDATE OF price, price_per_units ON listings
FOR EACH ROW EXECUTE FUNCTION listing_price_low();
