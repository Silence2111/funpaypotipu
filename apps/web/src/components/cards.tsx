import { tileFor } from '@/lib/tile';

/**
 * Заглушка обложки: цветная плитка с буквами названия.
 *
 * Серый прямоугольник с иконкой «нет изображения» на каждой карточке читается
 * как сломанная страница, а чужие обложки игр брать нельзя. Цвет выводится
 * из названия, поэтому у одной игры он всегда одинаковый.
 */
/** Плитка игры: обложка из консоли, а без неё — инициалы на цвете игры. */
export function GameTile({ title, size, cover }: { title: string; size: number; cover?: string | null }) {
  const t = tileFor(title);
  if (cover) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={cover} alt="" aria-hidden loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }} />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'inherit',
        background: t.background,
        color: t.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size,
        fontWeight: 800,
        letterSpacing: '-0.02em',
      }}
    >
      {t.initials}
    </div>
  );
}
