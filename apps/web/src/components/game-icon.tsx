import type { CSSProperties } from 'react';
import { gameIcon, monogram, monogramColor } from '@/lib/game-icons';

/**
 * Значок игры или сервиса — как значок приложения: фирменный цвет и знак (CSS-маска),
 * у кого знака нет — две буквы на своём насыщенном цвете. Подпись — рядом, значок скрыт от чтения экрана.
 */
export function GameIcon({ slug, title, size = 56 }: { slug: string; title: string; size?: number }) {
  const icon = gameIcon(slug);
  const box: CSSProperties = { width: size, height: size, borderRadius: Math.round(size * 0.24) };
  if (!icon) {
    return (
      // на мелких значках (в карточках 22–28 px) две буквы выходили 9–10 px — там одна, крупнее
      <span className="gicon gicon--letters" aria-hidden style={{ ...box, background: monogramColor(title), fontSize: Math.round(size * (size < 30 ? 0.5 : 0.36)) }}>
        {size < 30 ? monogram(title).slice(0, 1) : monogram(title)}
      </span>
    );
  }
  const glyph = Math.round(size * 0.56);
  return (
    <span className="gicon" aria-hidden style={{ ...box, background: icon.bg }}>
      <span
        className="gicon__g"
        style={{ width: glyph, height: glyph, background: icon.glyph, WebkitMaskImage: `url(${icon.src})`, maskImage: `url(${icon.src})` }}
      />
    </span>
  );
}
