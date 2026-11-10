/**
 * Замер выдачи каталога против тривиального правила.
 *
 * ## Зачем
 *
 * Покупатель платит комиссию не за список лотов — список есть и на FunPay.
 * Он платит за то, что первый лот в выдаче окажется надёжным: товар придёт,
 * спора не будет, возвращать деньги не придётся. Порядок выдачи стоит ровно
 * столько, на сколько бьёт правило, которое покупатель применит сам за минуту:
 *
 * - «сортируй по цене» — кнопка уже есть в каталоге;
 * - «сортируй по числу сделок продавца» — цифра видна в карточке;
 * - «бери первого в списке».
 *
 * ## Что выяснилось
 *
 * Ранжирования по надёжности в GameMarket нет. Порядок по умолчанию —
 * `boostUntil desc, createdAt desc` (`listings.service.ts`): наверху тот, кто
 * последним нажал «поднять», затем самый свежий лот. Это порядок по активности
 * продавца, а не по вероятности хорошей сделки. Уровень продавца
 * (`sellerLevel`) влияет на комиссию и холд, но не на место в выдаче.
 *
 * ## Как считается
 *
 * Ретроспективно: признаки лота и продавца — строго на момент заказа.
 * Метрика — согласованность (AUC) по парам «заказ завершён чисто ↔ спор или
 * возврат» внутри одной категории одной игры: там лоты конкурировали друг
 * с другом. 0.5 — монетка, 1.0 — идеальный порядок.
 *
 * Выдуманных данных здесь нет и не будет: на них выигрыш алгоритма
 * завышается на два порядка, потому что сравнение находит закономерность,
 * которую заложил автор генератора.
 */

/**
 * Сколько исходов более редкого класса нужно, чтобы увидеть разницу `effect`.
 * SE согласованности ≈ sqrt(p(1−p)/n); при p = 0.5 интервал уже эффекта,
 * когда n ≥ 0.25 / (effect/2)². Порог — выход формулы, а не число «на глаз».
 */
export function requiredOutcomes(effect: number): number {
  if (!(effect > 0)) throw new Error('Эффект должен быть положительным');
  return Math.ceil(0.25 / (effect / 2) ** 2);
}

/** Ниже этого нельзя назвать даже направление. */
export const THRESHOLD_TALK = requiredOutcomes(0.2); // 25
/** Ниже этого нельзя утверждать разницу в 10 пунктов. */
export const THRESHOLD_CLAIM = requiredOutcomes(0.1); // 100

export interface RankCandidate {
  /** id заказа */
  key: string;
  /** игра + категория: внутри неё лоты конкурировали */
  group: string;
  /** цена лота на момент заказа, минорные единицы */
  price: number;
  /** завершённых заказов продавца строго до момента заказа */
  sellerSalesBefore: number;
  /** средняя оценка продавца по отзывам строго до момента заказа */
  sellerRatingBefore: number | null;
  /** когда лот выставлен, мс */
  listedAt: number;
  /** true — завершён без спора и возврата; false — спор/возврат; null — не завершён */
  clean: boolean | null;
}

/** Ключ сортировки: меньше — выше в выдаче. Последний элемент — стабилизатор. */
export type RankRule = (c: RankCandidate) => Array<number | string>;

export const RANK_RULES: Record<string, RankRule> = {
  // Как сейчас: буст без истории в базе, поэтому берётся «новые первыми».
  'как_сейчас_новые_первыми': (c) => [-c.listedAt, c.key],
  'дешевле_сверху': (c) => [c.price, c.key],
  'по_сделкам_продавца': (c) => [-c.sellerSalesBefore, c.key],
  // Кандидат площадки. НЕ проверен на данных. Отзывов нет — не пятёрка, а 3.
  'надёжность_продавца': (c) => [
    -(c.sellerSalesBefore > 0 ? (c.sellerRatingBefore ?? 3) * Math.log1p(c.sellerSalesBefore) : 0),
    c.price,
    c.key,
  ],
};

/** Правила, которые покупатель применит сам. */
export const TRIVIAL_RULES = new Set([
  'как_сейчас_новые_первыми',
  'дешевле_сверху',
  'по_сделкам_продавца',
]);

const cmp = (a: Array<number | string>, b: Array<number | string>): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

export interface Concordance {
  share: number;
  pairs: number;
}

/**
 * Доля пар «чистый ↔ проблемный» внутри одной группы, где правило поставило
 * чистый выше. Ничья (правило не различает) — полбалла; последний элемент
 * ключа (стабилизатор) в ничью не входит, иначе правило «ничего не знаю»
 * выглядело бы как знающее.
 */
export function concordance(cands: RankCandidate[], rule: RankRule): Concordance | null {
  const groups = new Map<string, RankCandidate[]>();
  for (const c of cands) {
    if (c.clean === null) continue;
    const g = groups.get(c.group) ?? [];
    g.push(c);
    groups.set(c.group, g);
  }
  let ok = 0;
  let pairs = 0;
  for (const g of groups.values()) {
    const good = g.filter((c) => c.clean);
    const bad = g.filter((c) => !c.clean);
    for (const x of good) {
      for (const y of bad) {
        pairs++;
        const r = cmp(rule(x).slice(0, -1), rule(y).slice(0, -1));
        if (r < 0) ok += 1;
        else if (r === 0) ok += 0.5;
      }
    }
  }
  return pairs ? { share: ok / pairs, pairs } : null;
}

export interface BenchmarkReport {
  measured: boolean;
  reason: string;
  total: number;
  clean: number;
  problem: number;
  results: Record<string, Concordance>;
  caveats: string[];
  verdict: string;
  thresholds: { talk: number; claim: number };
}

export function benchmark(
  cands: RankCandidate[],
  opts: { demoOnly?: boolean; caveats?: string[] } = {},
): BenchmarkReport {
  const known = cands.filter((c) => c.clean !== null);
  const clean = known.filter((c) => c.clean).length;
  const problem = known.length - clean;
  const base = {
    total: cands.length,
    clean,
    problem,
    results: {} as Record<string, Concordance>,
    caveats: [...(opts.caveats ?? [])],
    thresholds: { talk: THRESHOLD_TALK, claim: THRESHOLD_CLAIM },
  };
  const refuse = (reason: string): BenchmarkReport => ({
    ...base,
    measured: false,
    reason,
    verdict:
      `Замер невозможен: ${reason} Нужно не меньше ${THRESHOLD_TALK} чистых и ` +
      `${THRESHOLD_TALK} проблемных заказов (спор или возврат), чтобы назвать ` +
      `направление, и по ${THRESHOLD_CLAIM} — чтобы утверждать разницу в 10 пунктов.`,
  });

  if (opts.demoOnly) {
    return refuse('в базе только демонстрационные заказы — на них меряется генератор сида, а не выдача.');
  }
  if (!known.length) return refuse(`заказов с известным исходом — 0 (всего ${cands.length}).`);
  if (Math.min(clean, problem) < THRESHOLD_TALK) {
    return refuse(`чистых заказов ${clean}, проблемных ${problem}.`);
  }

  for (const [name, rule] of Object.entries(RANK_RULES)) {
    const r = concordance(cands, rule);
    if (r) base.results[name] = r;
  }
  if (!Object.keys(base.results).length) {
    return refuse('ни в одной категории не встретились чистый и проблемный заказ одновременно.');
  }
  if (Math.min(clean, problem) < THRESHOLD_CLAIM) {
    base.caveats.push(
      `Исходов реже встречающегося класса ${Math.min(clean, problem)} из ${THRESHOLD_CLAIM}, ` +
        `нужных для утверждения разницы в 10 пунктов.`,
    );
  }

  const best = (pred: (n: string) => boolean) =>
    Object.entries(base.results)
      .filter(([n]) => pred(n))
      .sort((a, b) => b[1].share - a[1].share)[0];
  const trivial = best((n) => TRIVIAL_RULES.has(n));
  const ours = best((n) => !TRIVIAL_RULES.has(n));
  let verdict: string;
  if (!trivial || !ours) {
    verdict = 'Посчитано, но сравнивать не с чем.';
  } else {
    const d = ours[1].share - trivial[1].share;
    verdict =
      `«${ours[0]}» ${d > 0 ? 'лучше' : 'хуже'} лучшего тривиального правила «${trivial[0]}» ` +
      `на ${(Math.abs(d) * 100).toFixed(1)} пункта (${ours[1].share.toFixed(3)} против ` +
      `${trivial[1].share.toFixed(3)}).` +
      (Math.min(clean, problem) < THRESHOLD_CLAIM ? ' Данных мало: разница внутри погрешности.' : '');
  }
  return { ...base, measured: true, reason: 'посчитано на настоящих данных.', verdict };
}
