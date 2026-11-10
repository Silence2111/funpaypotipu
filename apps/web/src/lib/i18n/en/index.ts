/**
 * Английский словарь: русская фраза интерфейса → английская. Разбит по
 * частям сайта, чтобы правки не мешали друг другу; одна и та же фраза
 * в двух частях обязана переводиться одинаково — это проверяет
 * `scripts/i18n-check.mjs`. Импортируется только на сервере (server.ts),
 * в браузер приходит от сервера и только на английском.
 */
import { EN_SHARED } from '@gamemarket/shared/i18n';
import type { Dict } from '../lang';
import { ACCOUNT } from './account';
import { AUTH } from './auth';
import { CABINET } from './cabinet';
import { CATALOG } from './catalog';
import { COMMON } from './common';
import { DATA_CATALOG } from './data-catalog';
import { HELP } from './help';
import { LOT } from './lot';
import { ORDERS } from './orders';
import { PLURAL } from './plural';
import { PLURAL_ACCOUNT } from './plural-account';
import { PLURAL_CABINET } from './plural-cabinet';
import { PLURAL_CATALOG } from './plural-catalog';
import { PLURAL_LOT } from './plural-lot';
import { PLURAL_ORDERS } from './plural-orders';
import { PLURAL_SELLER } from './plural-seller';
import { SELLER } from './seller';

export const EN_DICT: Dict = {
  phrases: {
    ...COMMON,
    ...CATALOG,
    ...LOT,
    ...AUTH,
    ...ORDERS,
    ...CABINET,
    ...SELLER,
    ...ACCOUNT,
    ...HELP,
  },
  data: { ...EN_SHARED, ...DATA_CATALOG },
  plural: {
    ...PLURAL,
    ...PLURAL_CATALOG,
    ...PLURAL_LOT,
    ...PLURAL_ORDERS,
    ...PLURAL_CABINET,
    ...PLURAL_SELLER,
    ...PLURAL_ACCOUNT,
  },
};
