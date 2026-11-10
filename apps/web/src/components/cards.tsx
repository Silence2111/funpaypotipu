import { tileFor } from '@/lib/tile';

/**
 * Заглушка обложки: цветная плитка с буквами названия.
 *
 * Серый прямоугольник с иконкой «нет изображения» на каждой карточке читается
 * как сломанная страница, а чужие обложки игр брать нельзя. Цвет выводится
 * из названия, поэтому у одной игры он всегда одинаковый.
 */
export function GameTile({ title, size }: { title: string; size: number }) {
  const t = tileFor(title);
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
