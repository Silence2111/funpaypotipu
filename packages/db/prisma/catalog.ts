/**
 * Справочник площадки: игры, мобильные игры, приложения и их разделы.
 *
 * Биржу делает биржей охват: у FunPay 885 игр, у каждой — аккаунты, валюта,
 * предметы, донат, услуги. Восемь игр демо-витрины выглядели пустым сайтом,
 * сколько бы лотов в них ни лежало. Здесь — данные площадки, а не лоты:
 * пустой раздел честно пишет «предложений пока нет» и зовёт продать.
 *
 * Параметры раздела (сервер, ранг, платформа) — колонки и фильтры таблицы
 * раздела. Списки серверов и рангов — те, в которых мы уверены; где список
 * длинный и меняется (сервера RP-проектов), сервер — свободное поле.
 *
 * Пачка (`pack`) — у разделов валюты: все лоты раздела продают «за 1 000
 * золота», и сортировка по цене сравнивает одинаковое.
 *
 * Сид идемпотентен: `seedCatalog` обновляет названия, порядок и параметры,
 * но не меняет способ выдачи у существующего раздела — на нём держатся
 * выставленные лоты.
 */
import { CategorySegment, FulfillmentType, GameKind, type PrismaClient } from '@prisma/client';

export interface AttrSpec {
  key: string;
  label: string;
  type: 'enum' | 'bool' | 'string';
  options?: string[];
  required?: boolean;
}

export interface SectionSpec {
  slug: string;
  title: string;
  segment: CategorySegment;
  fulfillment: FulfillmentType;
  attrs?: AttrSpec[];
  /** Общая пачка раздела валюты: «за 1 000 золота». */
  pack?: { unit: string; per: number };
}

export interface GameSpec {
  slug: string;
  title: string;
  kind: GameKind;
  /** Как игру ищут: «кс», «дота», «вов». */
  aliases: string[];
  /** Место в «Популярных»; без него игра идёт по алфавиту после них. */
  popular?: number;
  sections: SectionSpec[];
}

// ── Параметры ──

const pick = (key: string, label: string, options: string[], required = false): AttrSpec => ({
  key,
  label,
  type: 'enum',
  options,
  required,
});
const flag = (key: string, label: string): AttrSpec => ({ key, label, type: 'bool' });
const text = (key: string, label: string, required = false): AttrSpec => ({ key, label, type: 'string', required });

const PLATFORM = pick('platform', 'Платформа', ['PC', 'PlayStation', 'Xbox'], true);
const PLATFORM_ALL = pick('platform', 'Платформа', ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Mobile']);
const KEY_REGION = pick(
  'region',
  'Регион активации',
  ['Россия', 'СНГ', 'Глобальный', 'Европа', 'Турция', 'Казахстан', 'Другой'],
  true,
);
const HOYO_SERVER = pick('server', 'Сервер', ['Europe', 'America', 'Asia', 'TW, HK, MO'], true);
const RP_SERVER = text('server', 'Сервер', true);
const TERM = pick('term', 'Срок', ['1 месяц', '3 месяца', '6 месяцев', '12 месяцев'], true);
const kinds = (options: string[]) => pick('kind', 'Услуга', options);

// ── Разделы ──

const { manual, auto_key: autoKey, provider } = FulfillmentType;

const accounts = (...attrs: AttrSpec[]): SectionSpec => ({
  slug: 'accounts',
  title: 'Аккаунты',
  segment: CategorySegment.accounts,
  fulfillment: manual,
  attrs,
});
const currency = (title: string, pack?: SectionSpec['pack'], ...attrs: AttrSpec[]): SectionSpec => ({
  slug: 'currency',
  title,
  segment: CategorySegment.currency,
  fulfillment: manual,
  pack,
  attrs,
});
const items = (title = 'Предметы', ...attrs: AttrSpec[]): SectionSpec => ({
  slug: 'items',
  title,
  segment: CategorySegment.items,
  fulfillment: manual,
  attrs,
});
/** Донат по ID или логину: продавец пополняет сам, как в разделах «Донат» на FunPay. */
const donate = (title = 'Донат', ...attrs: AttrSpec[]): SectionSpec => ({
  slug: 'donate',
  title,
  segment: CategorySegment.topup,
  fulfillment: manual,
  attrs,
});
const keys = (title = 'Ключи', ...attrs: AttrSpec[]): SectionSpec => ({
  slug: 'keys',
  title,
  segment: CategorySegment.key,
  fulfillment: autoKey,
  attrs,
});
const service = (title = 'Услуги', ...attrs: AttrSpec[]): SectionSpec => ({
  slug: 'service',
  title,
  segment: CategorySegment.service,
  fulfillment: manual,
  attrs,
});
const other = (): SectionSpec => ({
  slug: 'other',
  title: 'Прочее',
  segment: CategorySegment.service,
  fulfillment: manual,
});
/** Свой раздел приложения: подписка, звёзды, карты пополнения. */
const section = (
  slug: string,
  title: string,
  segment: CategorySegment,
  fulfillment: FulfillmentType = manual,
  ...attrs: AttrSpec[]
): SectionSpec => ({ slug, title, segment, fulfillment, attrs });

const BOOST = kinds(['Буст рейтинга', 'Калибровка', 'Обучение', 'Другое']);
const GOLD_K = { unit: 'золота', per: 1000 };
const VIRTS = { unit: 'виртов', per: 1_000_000 };

// ── Игры ──

export const CATALOG: GameSpec[] = [
  {
    slug: 'cs2',
    title: 'Counter-Strike 2',
    kind: GameKind.game,
    aliases: ['кс', 'кс2', 'cs', 'cs2', 'csgo', 'cs go', 'кс го', 'ксго', 'контра', 'counter strike'],
    popular: 1,
    sections: [
      accounts(
        pick('rank', 'Звание', ['Silver', 'Gold Nova', 'Master Guardian', 'Legendary Eagle', 'Supreme', 'Global Elite'], true),
        pick('region', 'Регион', ['EU', 'CIS', 'NA', 'Asia'], true),
        flag('prime', 'Prime-статус'),
        pick('delivery', 'Способ получения', ['Со сменой почты', 'Данные без входа', 'Перепривязка']),
      ),
      {
        slug: 'skins',
        title: 'Скины',
        segment: CategorySegment.items,
        fulfillment: manual,
        attrs: [
          pick(
            'rarity',
            'Редкость',
            ['Consumer', 'Industrial', 'Mil-Spec', 'Restricted', 'Classified', 'Covert', 'Нож/Перчатки'],
            true,
          ),
          flag('stattrak', 'StatTrak™'),
        ],
      },
      keys(
        'Ключи',
        pick('region', 'Регион', ['Global', 'EU', 'CIS', 'NA'], true),
        pick('platform', 'Платформа', ['Steam', 'Epic', 'Origin']),
      ),
      service('Буст', kinds(['Буст звания', 'Калибровка', 'Буст Faceit', 'Обучение'])),
      other(),
    ],
  },
  {
    slug: 'dota2',
    title: 'Dota 2',
    kind: GameKind.game,
    aliases: ['дота', 'дота 2', 'дота2', 'dota'],
    popular: 2,
    sections: [
      accounts(
        pick('rank', 'Ранг', ['Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal']),
      ),
      items(
        'Предметы',
        pick('rarity', 'Редкость', ['Common', 'Uncommon', 'Rare', 'Mythical', 'Legendary', 'Immortal', 'Arcana']),
      ),
      service('Буст MMR', kinds(['Буст MMR', 'Калибровка', 'Обучение', 'Другое'])),
      other(),
    ],
  },
  {
    slug: 'steam',
    title: 'Steam',
    kind: GameKind.app,
    aliases: ['стим', 'стим кошелек', 'стим кошелёк', 'пополнение стим', 'steam wallet'],
    popular: 3,
    sections: [
      section('topup', 'Пополнение кошелька', CategorySegment.topup, provider),
      keys('Ключи игр', KEY_REGION),
      section('gifts', 'Гифты', CategorySegment.items, manual, KEY_REGION),
      accounts(),
    ],
  },
  {
    slug: 'roblox',
    title: 'Roblox',
    kind: GameKind.game,
    aliases: ['роблокс', 'робукс', 'робуксы', 'robux'],
    popular: 4,
    sections: [
      currency('Робуксы', { unit: 'Robux', per: 100 }),
      items(
        'Предметы',
        pick('mode', 'Режим', ['Adopt Me', 'Blox Fruits', 'Murder Mystery 2', 'Pet Simulator 99', 'Grow a Garden', 'Другой']),
      ),
      accounts(),
      other(),
    ],
  },
  {
    slug: 'genshin',
    title: 'Genshin Impact',
    kind: GameKind.game,
    aliases: ['геншин', 'генш', 'геншин импакт', 'genshin'],
    popular: 5,
    sections: [
      accounts(HOYO_SERVER),
      section('topup', 'Донат', CategorySegment.topup, provider),
      service('Услуги', kinds(['Прокачка', 'Исследование мира', 'Витая бездна', 'Ежедневные поручения'])),
    ],
  },
  {
    slug: 'brawl-stars',
    title: 'Brawl Stars',
    kind: GameKind.mobile,
    aliases: ['бравл', 'бравл старс', 'бс', 'brawl'],
    popular: 6,
    sections: [accounts(), currency('Гемы'), service('Буст кубков')],
  },
  {
    slug: 'standoff2',
    title: 'Standoff 2',
    kind: GameKind.mobile,
    aliases: ['стандофф', 'стандофф 2', 'стендофф', 'со2', 'standoff'],
    popular: 7,
    sections: [currency('Голда', { unit: 'голды', per: 100 }), items('Скины'), accounts()],
  },
  {
    slug: 'telegram',
    title: 'Telegram',
    kind: GameKind.app,
    aliases: ['телеграм', 'телега', 'тг', 'звезды', 'звёзды', 'tg', 'stars'],
    popular: 8,
    sections: [
      { ...section('stars', 'Звёзды', CategorySegment.currency), pack: { unit: 'звёзд', per: 100 } },
      section('premium', 'Premium', CategorySegment.service, manual, pick('term', 'Срок', ['3 месяца', '6 месяцев', '12 месяцев'], true)),
      section('gifts', 'Подарки', CategorySegment.items),
      section('usernames', 'Юзернеймы', CategorySegment.items),
      accounts(),
    ],
  },
  {
    slug: 'fortnite',
    title: 'Fortnite',
    kind: GameKind.game,
    aliases: ['фортнайт', 'форт', 'вбаксы', 'в-баксы', 'v-bucks'],
    popular: 9,
    sections: [accounts(PLATFORM_ALL), donate('В-баксы'), items('Предметы')],
  },
  {
    slug: 'valorant',
    title: 'Valorant',
    kind: GameKind.game,
    aliases: ['валорант', 'валик', 'вало'],
    popular: 10,
    sections: [
      accounts(
        pick('region', 'Регион', ['EU', 'NA', 'AP', 'KR'], true),
        pick('rank', 'Ранг', ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant']),
      ),
      donate('Valorant Points'),
      service('Буст', BOOST),
    ],
  },
  {
    slug: 'wow',
    title: 'World of Warcraft',
    kind: GameKind.game,
    aliases: ['вов', 'варкрафт', 'wow', 'world of warcraft'],
    popular: 11,
    sections: [
      currency(
        'Золото',
        GOLD_K,
        pick(
          'server',
          'Сервер',
          [
            'Азурегос',
            'Борейская тундра',
            'Вечная Песня',
            'Галакронд',
            'Гордунни',
            'Гром',
            'Дракономор',
            'Король-лич',
            'Пиратская Бухта',
            'Подземье',
            'Разувий',
            'Ревущий фьорд',
            'Свежеватель Душ',
            'Седогрив',
            'Страж Смерти',
            'Термоштепсель',
            'Ткач Смерти',
            'Черный Шрам',
            'Ясеневый лес',
            'Другой',
          ],
          true,
        ),
        pick('side', 'Сторона', ['Альянс', 'Орда'], true),
      ),
      accounts(),
      service('Буст', kinds(['Рейды', 'Эпохальные+ подземелья', 'PvP-рейтинг', 'Прокачка', 'Другое'])),
      items('Предметы'),
      other(),
    ],
  },
  {
    slug: 'minecraft',
    title: 'Minecraft',
    kind: GameKind.game,
    aliases: ['майнкрафт', 'майн', 'minecraft'],
    popular: 12,
    sections: [
      accounts(pick('edition', 'Издание', ['Java', 'Bedrock', 'Java и Bedrock'], true)),
      keys('Лицензии'),
      service('Услуги', kinds(['Постройки', 'Сборки модов', 'Настройка сервера', 'Другое'])),
      other(),
    ],
  },
  {
    slug: 'gta5',
    title: 'GTA V',
    kind: GameKind.game,
    aliases: ['гта', 'гта 5', 'гта5', 'gta', 'gta 5', 'gta online', 'гта онлайн'],
    popular: 13,
    sections: [
      currency('Деньги GTA Online', { unit: '$', per: 1_000_000 }, PLATFORM),
      accounts(PLATFORM),
      service('Прокачка'),
      keys('Ключи', KEY_REGION),
    ],
  },
  {
    slug: 'mir-tankov',
    title: 'Мир танков',
    kind: GameKind.game,
    aliases: ['мир танков', 'танки', 'мт', 'леста'],
    popular: 14,
    sections: [accounts(), currency('Золото', GOLD_K), service('Услуги', kinds(['Прокачка ветки', 'Фарм серебра', 'Отметки на стволе']))],
  },
  {
    slug: 'pubg-mobile',
    title: 'PUBG Mobile',
    kind: GameKind.mobile,
    aliases: ['пабг мобайл', 'пубг мобайл', 'пабг', 'юси', 'uc'],
    popular: 15,
    sections: [donate('UC'), accounts(), items('Предметы')],
  },
  {
    slug: 'tarkov',
    title: 'Escape from Tarkov',
    kind: GameKind.game,
    aliases: ['тарков', 'eft', 'побег из таркова', 'тарк'],
    popular: 16,
    sections: [
      accounts(
        pick('edition', 'Издание', ['Standard', 'Left Behind', 'Prepare for Escape', 'Edge of Darkness', 'Unheard'], true),
      ),
      currency('Рубли', { unit: 'рублей', per: 1_000_000 }),
      items('Предметы'),
      service('Услуги', kinds(['Квесты', 'Прокачка', 'Сопровождение в рейдах', 'Другое'])),
    ],
  },
  {
    slug: 'gta5rp',
    title: 'GTA 5 RP',
    kind: GameKind.game,
    aliases: ['гта 5 рп', 'гта рп', 'gta5rp', 'gta 5 rp', 'вирты'],
    popular: 17,
    sections: [
      currency(
        'Вирты',
        VIRTS,
        pick(
          'server',
          'Сервер',
          [
            'Downtown',
            'Strawberry',
            'Vinewood',
            'Blackberry',
            'Insquad',
            'Sunrise',
            'Rainbow',
            'Richman',
            'Eclipse',
            'La Mesa',
            'Burton',
            'Rockford',
            'Alta',
            'Del Perro',
            'Davis',
            'Harmony',
            'Redwood',
            'Hawick',
            'Другой',
          ],
          true,
        ),
      ),
      accounts(),
      items('Имущество'),
      service('Услуги'),
    ],
  },
  {
    slug: 'fc',
    title: 'EA Sports FC',
    kind: GameKind.game,
    aliases: ['фифа', 'fifa', 'фс', 'fc', 'fc 26', 'fc 25', 'ea fc', 'монеты фифа'],
    popular: 18,
    sections: [
      currency('Монеты FC', { unit: 'монет', per: 100_000 }, PLATFORM),
      accounts(PLATFORM),
      donate('FC Points'),
      service('Услуги'),
    ],
  },
  {
    slug: 'mlbb',
    title: 'Mobile Legends',
    kind: GameKind.mobile,
    aliases: ['мобайл легендс', 'млбб', 'mlbb', 'мобла', 'mobile legends'],
    popular: 19,
    sections: [donate('Алмазы'), accounts(), service('Буст', BOOST)],
  },
  {
    slug: 'discord',
    title: 'Discord',
    kind: GameKind.app,
    aliases: ['дискорд', 'дс', 'нитро', 'nitro'],
    popular: 20,
    sections: [
      section(
        'nitro',
        'Nitro',
        CategorySegment.service,
        manual,
        pick('plan', 'Тариф', ['Nitro', 'Nitro Basic'], true),
        pick('term', 'Срок', ['1 месяц', '12 месяцев'], true),
      ),
      section('decorations', 'Украшения профиля', CategorySegment.items),
      accounts(),
    ],
  },

  // ── Игры по алфавиту ──
  {
    slug: 'albion',
    title: 'Albion Online',
    kind: GameKind.game,
    aliases: ['альбион'],
    sections: [
      currency('Серебро', { unit: 'серебра', per: 1_000_000 }, pick('server', 'Сервер', ['Europe', 'Americas', 'Asia'], true)),
      accounts(),
      items('Предметы'),
      service('Услуги'),
    ],
  },
  {
    slug: 'apex',
    title: 'Apex Legends',
    kind: GameKind.game,
    aliases: ['апекс', 'apex'],
    sections: [
      accounts(PLATFORM),
      donate('Монеты Apex'),
      service('Буст', kinds(['Буст ранга', 'Бейджи', 'Обучение', 'Другое'])),
    ],
  },
  {
    slug: 'archeage',
    title: 'ArcheAge',
    kind: GameKind.game,
    aliases: ['архейдж', 'аа', 'archeage'],
    sections: [currency('Золото'), accounts(), items('Предметы')],
  },
  {
    slug: 'arizona',
    title: 'Arizona RP',
    kind: GameKind.game,
    aliases: ['аризона', 'аризона рп', 'samp', 'самп'],
    sections: [currency('Вирты', VIRTS, RP_SERVER), accounts(), items('Имущество')],
  },
  {
    slug: 'bdo',
    title: 'Black Desert',
    kind: GameKind.game,
    aliases: ['бдо', 'black desert', 'блэк десерт', 'блек десерт'],
    sections: [accounts(), currency('Серебро'), service('Услуги')],
  },
  {
    slug: 'warzone',
    title: 'Call of Duty',
    kind: GameKind.game,
    aliases: ['кал оф дьюти', 'колда', 'cod', 'варзон', 'warzone', 'black ops'],
    sections: [accounts(PLATFORM), donate('COD Points'), service('Буст', BOOST)],
  },
  {
    slug: 'dbd',
    title: 'Dead by Daylight',
    kind: GameKind.game,
    aliases: ['дбд', 'дед бай дейлайт', 'dbd'],
    sections: [accounts(PLATFORM_ALL), service('Услуги'), other()],
  },
  {
    slug: 'destiny2',
    title: 'Destiny 2',
    kind: GameKind.game,
    aliases: ['дестини', 'дестини 2', 'destiny'],
    sections: [
      accounts(PLATFORM),
      service('Услуги', kinds(['Рейды', 'Подземелья', 'Испытания Осириса', 'Прохождение', 'Другое'])),
    ],
  },
  {
    slug: 'diablo4',
    title: 'Diablo IV',
    kind: GameKind.game,
    aliases: ['диабло', 'диабло 4', 'd4', 'diablo'],
    sections: [currency('Золото'), items('Предметы'), service('Услуги'), accounts()],
  },
  {
    slug: 'elden-ring',
    title: 'Elden Ring',
    kind: GameKind.game,
    aliases: ['элден ринг', 'элден', 'elden'],
    sections: [keys('Ключи', KEY_REGION), items('Предметы и руны', PLATFORM), service('Прохождение')],
  },
  {
    slug: 'eve',
    title: 'EVE Online',
    kind: GameKind.game,
    aliases: ['ева', 'ева онлайн', 'eve'],
    sections: [currency('ISK', { unit: 'ISK', per: 1_000_000 }), accounts(), other()],
  },
  {
    slug: 'ff14',
    title: 'Final Fantasy XIV',
    kind: GameKind.game,
    aliases: ['фф14', 'ффxiv', 'ffxiv', 'final fantasy'],
    sections: [currency('Гил'), accounts(), service('Услуги')],
  },
  {
    slug: 'hearthstone',
    title: 'Hearthstone',
    kind: GameKind.game,
    aliases: ['хартстоун', 'хс', 'hearthstone'],
    sections: [accounts(), service('Услуги'), other()],
  },
  {
    slug: 'lol',
    title: 'League of Legends',
    kind: GameKind.game,
    aliases: ['лол', 'лига легенд', 'lol', 'league'],
    sections: [
      accounts(
        pick('server', 'Сервер', ['EUW', 'EUNE', 'NA', 'TR', 'Другой'], true),
        pick('rank', 'Ранг', [
          'Iron',
          'Bronze',
          'Silver',
          'Gold',
          'Platinum',
          'Emerald',
          'Diamond',
          'Master',
          'Grandmaster',
          'Challenger',
        ]),
      ),
      donate('Riot Points'),
      service('Буст', BOOST),
    ],
  },
  {
    slug: 'lineage2',
    title: 'Lineage 2',
    kind: GameKind.game,
    aliases: ['л2', 'линейка', 'lineage', 'la2'],
    sections: [currency('Адена', { unit: 'адены', per: 1_000_000 }, text('server', 'Сервер', true)), accounts(), items('Предметы')],
  },
  {
    slug: 'lost-ark',
    title: 'Lost Ark',
    kind: GameKind.game,
    aliases: ['лост арк', 'лостарк', 'lost ark'],
    sections: [currency('Золото'), accounts(), service('Услуги')],
  },
  {
    slug: 'majestic',
    title: 'Majestic RP',
    kind: GameKind.game,
    aliases: ['маджестик', 'маджестик рп', 'majestic'],
    sections: [currency('Вирты', VIRTS, RP_SERVER), accounts(), items('Имущество')],
  },
  {
    slug: 'marvel-rivals',
    title: 'Marvel Rivals',
    kind: GameKind.game,
    aliases: ['марвел', 'марвел ривалс', 'rivals'],
    sections: [accounts(PLATFORM), donate('Донат'), service('Буст', BOOST)],
  },
  {
    slug: 'wows',
    title: 'Мир кораблей',
    kind: GameKind.game,
    aliases: ['мир кораблей', 'корабли', 'world of warships', 'wows'],
    sections: [accounts(), donate('Дублоны')],
  },
  {
    slug: 'osrs',
    title: 'Old School RuneScape',
    kind: GameKind.game,
    aliases: ['osrs', 'руна', 'runescape', 'рунскейп'],
    sections: [currency('Золото', { unit: 'золота', per: 1_000_000 }), accounts(), service('Услуги')],
  },
  {
    slug: 'overwatch2',
    title: 'Overwatch 2',
    kind: GameKind.game,
    aliases: ['овервотч', 'ов', 'ow2', 'overwatch'],
    sections: [accounts(PLATFORM), donate('Монеты Overwatch'), service('Буст', BOOST)],
  },
  {
    slug: 'poe',
    title: 'Path of Exile',
    kind: GameKind.game,
    aliases: ['пое', 'poe', 'path of exile'],
    sections: [
      currency(
        'Сферы',
        { unit: 'Divine Orb', per: 1 },
        pick('league', 'Лига', ['Текущая лига', 'Хардкор текущей лиги', 'Standard', 'Hardcore'], true),
      ),
      items('Предметы'),
      service('Услуги'),
    ],
  },
  {
    slug: 'poe2',
    title: 'Path of Exile 2',
    kind: GameKind.game,
    aliases: ['пое 2', 'пое2', 'poe 2', 'poe2'],
    sections: [currency('Сферы', { unit: 'Divine Orb', per: 1 }), items('Предметы'), service('Услуги')],
  },
  {
    slug: 'perfect-world',
    title: 'Perfect World',
    kind: GameKind.game,
    aliases: ['пв', 'перфект ворлд', 'pw'],
    sections: [currency('Юани'), accounts()],
  },
  {
    slug: 'pubg',
    title: 'PUBG: Battlegrounds',
    kind: GameKind.game,
    aliases: ['пабг', 'пубг', 'pubg', 'батлграундс'],
    sections: [accounts(), donate('G-Coin'), items('Предметы')],
  },
  {
    slug: 'radmir',
    title: 'Radmir RP',
    kind: GameKind.game,
    aliases: ['радмир', 'радмир рп', 'radmir'],
    sections: [currency('Вирты', VIRTS, RP_SERVER), accounts()],
  },
  {
    slug: 'r6',
    title: 'Rainbow Six Siege',
    kind: GameKind.game,
    aliases: ['радуга', 'r6', 'рейнбоу', 'rainbow six'],
    sections: [accounts(PLATFORM), donate('R6 Credits'), service('Буст', BOOST)],
  },
  {
    slug: 'rust',
    title: 'Rust',
    kind: GameKind.game,
    aliases: ['раст'],
    sections: [accounts(), items('Скины'), other()],
  },
  {
    slug: 'tl',
    title: 'Throne and Liberty',
    kind: GameKind.game,
    aliases: ['трон', 'тнл', 'throne and liberty', 'tl'],
    sections: [currency('Люсент'), accounts(), service('Услуги')],
  },
  {
    slug: 'war-thunder',
    title: 'War Thunder',
    kind: GameKind.game,
    aliases: ['вар тандер', 'тундра', 'вартандер', 'wt'],
    sections: [accounts(), donate('Золотые орлы'), service('Прокачка')],
  },
  {
    slug: 'warframe',
    title: 'Warframe',
    kind: GameKind.game,
    aliases: ['варфрейм', 'warframe'],
    sections: [
      currency('Платина', { unit: 'платины', per: 100 }, pick('platform', 'Платформа', ['PC', 'PlayStation', 'Xbox', 'Nintendo Switch'], true)),
      items('Предметы'),
      accounts(),
    ],
  },
  {
    slug: 'wot',
    title: 'World of Tanks',
    kind: GameKind.game,
    aliases: ['вот', 'world of tanks', 'wot', 'танки eu'],
    sections: [
      accounts(pick('region', 'Регион', ['EU', 'NA', 'Asia'])),
      currency('Золото', GOLD_K),
      service('Услуги', kinds(['Прокачка ветки', 'Фарм серебра', 'Отметки на стволе'])),
    ],
  },
  {
    slug: 'wow-classic',
    title: 'World of Warcraft Classic',
    kind: GameKind.game,
    aliases: ['вов классик', 'классик', 'wow classic', 'варкрафт классик'],
    sections: [currency('Золото', { unit: 'золота', per: 10 }, text('server', 'Сервер', true)), accounts(), service('Буст')],
  },

  // ── Мобильные игры ──
  {
    slug: 'afk-journey',
    title: 'AFK Journey',
    kind: GameKind.mobile,
    aliases: ['афк джорни', 'afk journey'],
    sections: [accounts(), donate()],
  },
  {
    slug: 'arena-breakout',
    title: 'Arena Breakout',
    kind: GameKind.mobile,
    aliases: ['арена брейкаут', 'арена', 'arena breakout'],
    sections: [accounts(), donate()],
  },
  {
    slug: 'black-russia',
    title: 'Black Russia',
    kind: GameKind.mobile,
    aliases: ['блек раша', 'блэк раша', 'black russia', 'br'],
    sections: [currency('Вирты', VIRTS, RP_SERVER), accounts(), items('Имущество')],
  },
  {
    slug: 'blood-strike',
    title: 'Blood Strike',
    kind: GameKind.mobile,
    aliases: ['блад страйк', 'blood strike'],
    sections: [accounts(), donate('Золото')],
  },
  {
    slug: 'codm',
    title: 'Call of Duty: Mobile',
    kind: GameKind.mobile,
    aliases: ['кодм', 'колда мобайл', 'cod mobile', 'codm'],
    sections: [accounts(), donate('CP')],
  },
  {
    slug: 'clash-of-clans',
    title: 'Clash of Clans',
    kind: GameKind.mobile,
    aliases: ['клеш оф кланс', 'клэш оф кланс', 'кок', 'coc'],
    sections: [accounts(), donate('Гемы')],
  },
  {
    slug: 'clash-royale',
    title: 'Clash Royale',
    kind: GameKind.mobile,
    aliases: ['клеш рояль', 'клэш рояль', 'кр', 'clash royale'],
    sections: [accounts(), donate('Гемы')],
  },
  {
    slug: 'fc-mobile',
    title: 'EA Sports FC Mobile',
    kind: GameKind.mobile,
    aliases: ['фифа мобайл', 'fc mobile', 'фс мобайл', 'fifa mobile'],
    sections: [accounts(), donate('FC Points')],
  },
  {
    slug: 'free-fire',
    title: 'Free Fire',
    kind: GameKind.mobile,
    aliases: ['фри фаер', 'фри фаир', 'free fire', 'ff'],
    sections: [donate('Алмазы'), accounts()],
  },
  {
    slug: 'hay-day',
    title: 'Hay Day',
    kind: GameKind.mobile,
    aliases: ['хей дей', 'хэй дэй', 'hay day'],
    sections: [accounts(), items('Товары фермы')],
  },
  {
    slug: 'hsr',
    title: 'Honkai: Star Rail',
    kind: GameKind.mobile,
    aliases: ['хср', 'хонкай', 'хонкай стар рейл', 'hsr', 'star rail'],
    sections: [accounts(HOYO_SERVER), donate(), service('Услуги')],
  },
  {
    slug: 'last-war',
    title: 'Last War: Survival',
    kind: GameKind.mobile,
    aliases: ['ласт вар', 'last war'],
    sections: [accounts(), donate()],
  },
  {
    slug: 'pokemon-go',
    title: 'Pokémon GO',
    kind: GameKind.mobile,
    aliases: ['покемон го', 'покемон', 'pokemon go', 'pokemon'],
    sections: [accounts(), service('Услуги')],
  },
  {
    slug: 'raid',
    title: 'Raid: Shadow Legends',
    kind: GameKind.mobile,
    aliases: ['рейд', 'рейд шадоу легендс', 'raid'],
    sections: [accounts(), donate()],
  },
  {
    slug: 'rok',
    title: 'Rise of Kingdoms',
    kind: GameKind.mobile,
    aliases: ['рок', 'райз оф кингдомс', 'rise of kingdoms'],
    sections: [accounts(), donate()],
  },
  {
    slug: 'stumble-guys',
    title: 'Stumble Guys',
    kind: GameKind.mobile,
    aliases: ['стамбл гайс', 'stumble guys'],
    sections: [accounts(), donate('Гемы')],
  },
  {
    slug: 'whiteout',
    title: 'Whiteout Survival',
    kind: GameKind.mobile,
    aliases: ['вайтаут', 'whiteout'],
    sections: [accounts(), donate()],
  },
  {
    slug: 'wild-rift',
    title: 'Wild Rift',
    kind: GameKind.mobile,
    aliases: ['вайлд рифт', 'вр', 'wild rift'],
    sections: [accounts(), donate('Wild Cores')],
  },
  {
    slug: 'zzz',
    title: 'Zenless Zone Zero',
    kind: GameKind.mobile,
    aliases: ['ззз', 'zzz', 'зенлесс'],
    sections: [accounts(HOYO_SERVER), donate()],
  },

  // ── Приложения и сервисы ──
  {
    slug: 'apple',
    title: 'Apple',
    kind: GameKind.app,
    aliases: ['эпл', 'айтюнс', 'itunes', 'apple id', 'app store', 'эпл айди'],
    sections: [section('cards', 'Подарочные карты', CategorySegment.key, autoKey, KEY_REGION), accounts()],
  },
  {
    slug: 'battlenet',
    title: 'Battle.net',
    kind: GameKind.app,
    aliases: ['батлнет', 'батл нет', 'близзард', 'blizzard', 'battle.net'],
    sections: [donate('Пополнение баланса'), accounts(), keys('Ключи', KEY_REGION)],
  },
  {
    slug: 'ea',
    title: 'EA app',
    kind: GameKind.app,
    aliases: ['ea', 'origin', 'ориджин', 'ea play'],
    sections: [accounts(), keys('Ключи', KEY_REGION)],
  },
  {
    slug: 'epic',
    title: 'Epic Games',
    kind: GameKind.app,
    aliases: ['эпик', 'эпик геймс', 'egs', 'epic games'],
    sections: [accounts(), keys('Ключи', KEY_REGION)],
  },
  {
    slug: 'faceit',
    title: 'FACEIT',
    kind: GameKind.app,
    aliases: ['фейсит', 'фасеит', 'faceit'],
    sections: [
      accounts(pick('level', 'Уровень', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])),
      section('premium', 'Premium', CategorySegment.service, manual, TERM),
    ],
  },
  {
    slug: 'google-play',
    title: 'Google Play',
    kind: GameKind.app,
    aliases: ['гугл плей', 'гугл', 'google play'],
    sections: [section('cards', 'Подарочные карты', CategorySegment.key, autoKey, KEY_REGION)],
  },
  {
    slug: 'nintendo',
    title: 'Nintendo',
    kind: GameKind.app,
    aliases: ['нинтендо', 'свитч', 'switch', 'eshop'],
    sections: [section('cards', 'Карты eShop', CategorySegment.key, autoKey, KEY_REGION), accounts()],
  },
  {
    slug: 'playstation',
    title: 'PlayStation',
    kind: GameKind.app,
    aliases: ['плейстейшн', 'пс', 'ps', 'psn', 'ps plus', 'пс плюс', 'плойка'],
    sections: [
      accounts(pick('region', 'Регион', ['Турция', 'Индия', 'Польша', 'Украина', 'США', 'Другой'], true)),
      section(
        'ps-plus',
        'PS Plus',
        CategorySegment.service,
        manual,
        pick('tier', 'Подписка', ['Essential', 'Extra', 'Deluxe'], true),
        pick('term', 'Срок', ['1 месяц', '3 месяца', '12 месяцев'], true),
      ),
      section('cards', 'Карты пополнения', CategorySegment.key, autoKey, KEY_REGION),
      section('games', 'Игры на аккаунт', CategorySegment.service),
    ],
  },
  {
    slug: 'spotify',
    title: 'Spotify',
    kind: GameKind.app,
    aliases: ['спотифай', 'spotify'],
    sections: [
      section('premium', 'Premium', CategorySegment.service, manual, pick('plan', 'Тариф', ['Individual', 'Duo', 'Family'], true), TERM),
      accounts(),
    ],
  },
  {
    slug: 'tiktok',
    title: 'TikTok',
    kind: GameKind.app,
    aliases: ['тикток', 'тик ток', 'тт', 'tiktok'],
    sections: [donate('Монеты'), accounts()],
  },
  {
    slug: 'ubisoft',
    title: 'Ubisoft Connect',
    kind: GameKind.app,
    aliases: ['юбисофт', 'uplay', 'юплей', 'ubisoft'],
    sections: [accounts(), keys('Ключи', KEY_REGION)],
  },
  {
    slug: 'xbox',
    title: 'Xbox',
    kind: GameKind.app,
    aliases: ['иксбокс', 'хбокс', 'xbox', 'game pass', 'гейм пасс'],
    sections: [
      section('game-pass', 'Game Pass', CategorySegment.key, autoKey, pick('term', 'Срок', ['1 месяц', '3 месяца', '12 месяцев'])),
      section('cards', 'Карты пополнения', CategorySegment.key, autoKey, KEY_REGION),
      accounts(),
    ],
  },
  {
    slug: 'youtube',
    title: 'YouTube',
    kind: GameKind.app,
    aliases: ['ютуб', 'youtube premium', 'ютуб премиум'],
    sections: [section('premium', 'Premium', CategorySegment.service, manual, TERM)],
  },
];

/**
 * Разделы, которых больше нет в справочнике: их лоты переезжают в новый
 * раздел той же игры, старый раздел скрывается. У CS2 были «Предметы» и
 * «Скины и предметы» одновременно — покупатель не знал, где искать.
 */
export const RETIRED: Array<{ game: string; slug: string; into: string }> = [{ game: 'cs2', slug: 'items', into: 'skins' }];

/** Кладёт справочник в базу. Повторный запуск ничего не дублирует. */
export async function seedCatalog(prisma: PrismaClient) {
  for (const g of CATALOG) {
    const game = await prisma.game.upsert({
      where: { slug: g.slug },
      update: { title: g.title, kind: g.kind, aliases: g.aliases, sortOrder: g.popular ?? 100, isActive: true },
      create: { slug: g.slug, title: g.title, kind: g.kind, aliases: g.aliases, sortOrder: g.popular ?? 100 },
    });
    for (const [si, s] of g.sections.entries()) {
      const common = {
        title: s.title,
        segment: s.segment,
        sortOrder: si + 1,
        unitName: s.pack?.unit ?? null,
        pricePerUnits: s.pack?.per ?? null,
        isActive: true,
      };
      const category = await prisma.category.upsert({
        where: { gameId_slug: { gameId: game.id, slug: s.slug } },
        // Способ выдачи существующего раздела не трогаем: по нему уже
        // выставлены лоты, и ключи не станут ручной выдачей задним числом.
        update: common,
        create: { gameId: game.id, slug: s.slug, fulfillmentType: s.fulfillment, ...common },
      });
      const keys = new Set<string>();
      for (const [ai, a] of (s.attrs ?? []).entries()) {
        keys.add(a.key);
        const data = {
          label: a.label,
          type: a.type,
          options: a.options ?? undefined,
          isRequired: a.required ?? false,
          isFilter: a.type !== 'string',
          sortOrder: ai + 1,
        };
        await prisma.attribute.upsert({
          where: { categoryId_key: { categoryId: category.id, key: a.key } },
          update: data,
          create: { categoryId: category.id, key: a.key, ...data },
        });
      }
      // Параметр убрали из справочника — из формы и фильтров он уходит.
      await prisma.attribute.deleteMany({ where: { categoryId: category.id, key: { notIn: [...keys] } } });
    }
  }

  for (const r of RETIRED) {
    const game = await prisma.game.findUnique({ where: { slug: r.game } });
    if (!game) continue;
    const [from, into] = await Promise.all([
      prisma.category.findUnique({ where: { gameId_slug: { gameId: game.id, slug: r.slug } } }),
      prisma.category.findUnique({ where: { gameId_slug: { gameId: game.id, slug: r.into } } }),
    ]);
    if (!from || !into) continue;
    await prisma.listing.updateMany({ where: { categoryId: from.id }, data: { categoryId: into.id } });
    await prisma.category.update({ where: { id: from.id }, data: { isActive: false } });
  }
}
