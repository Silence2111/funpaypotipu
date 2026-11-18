import type { CSSProperties } from 'react';
import { gameIcon } from '@/lib/game-icons';
import { GameTile } from './cards';

/**
 * Значок игры или сервиса в лёгком виде: бледная плитка цвета марки и сам знак этим цветом
 * (знак — CSS-маска, цвет задаётся стилем, поэтому верен в обеих темах). У кого знака нет —
 * буквенная плитка. Подпись — рядом, сам значок для чтения экрана скрыт.
 */
export function GameIcon({ slug, title, size = 56 }: { slug: string; title: string; size?: number }) {
  const icon = gameIcon(slug);
  const radius = Math.round(size * 0.27);
  if (!icon) {
    return (
      <span className="gicon" aria-hidden style={{ width: size, height: size, borderRadius: radius }}>
        <GameTile title={title} size={Math.round(size * 0.34)} />
      </span>
    );
  }
  const glyph = Math.round(size * 0.52);
  return (
    <span
      className={icon.color ? 'gicon gicon--brand' : 'gicon gicon--neutral'}
      aria-hidden
      style={{ width: size, height: size, borderRadius: radius, ['--brand' as string]: icon.color ?? undefined } as CSSProperties}
    >
      <span
        className="gicon__g"
        style={{ width: glyph, height: glyph, WebkitMaskImage: `url(${icon.src})`, maskImage: `url(${icon.src})` }}
      />
    </span>
  );
}
