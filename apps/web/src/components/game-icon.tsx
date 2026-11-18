import { gameIcon } from '@/lib/game-icons';
import { GameTile } from './cards';

/**
 * Значок игры или сервиса: фирменный знак на фирменном цвете (как значок приложения),
 * у кого знака нет — буквенная плитка. Подпись — рядом, сам значок для чтения экрана скрыт.
 */
export function GameIcon({ slug, title, size = 56 }: { slug: string; title: string; size?: number }) {
  const icon = gameIcon(slug);
  return (
    <span
      className="gicon"
      aria-hidden
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), background: icon?.bg }}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon.src} alt="" width={Math.round(size * 0.54)} height={Math.round(size * 0.54)} loading="lazy" />
      ) : (
        <GameTile title={title} size={Math.round(size * 0.34)} />
      )}
    </span>
  );
}
