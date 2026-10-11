import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift } from 'lucide-react';
import { baseItemOf } from '@agora/shared';
import { world } from '../net/client';
import { store, useStore } from '../state/store';
import { giftableStacks } from '../worlds/gifts';
import { worldHud } from '../worlds/ui/hudState';

/** How long the answer to a gift stays on screen. */
const RESULT_MS = 8000;
/** A gift with no answer after this long no longer blocks the next one. */
const WAIT_MS = 10000;

/** A fresh idempotency key for one gift (the server replays the first answer for a resend). */
const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Offer something from the bag to the character beside you (P17.26b, ADR-053). The server decides
 * everything (the bag, one gift a day and two a week, the range); this lists what can be given, sends
 * one gift with its own key, and shows how the character took it.
 */
export function GiftPicker({ npcId, name }: { npcId: string; name: string }) {
  const { t } = useTranslation();
  const hud = useSyncExternalStore(worldHud.subscribe, worldHud.get, worldHud.get);
  const result = useStore((s) => (s.giftResult?.npcId === npcId ? s.giftResult : null));
  const hearts = useStore((s) => s.hearts?.[npcId.replace(/^npc:/, '')]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ key: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const stacks = useMemo(() => giftableStacks(hud.items), [hud.items]);

  useEffect(() => {
    if (open) world.send({ t: 'office:inv' });
  }, [open]);
  useEffect(() => {
    if (pending && result?.key === pending.key) setPending(null);
  }, [pending, result]);
  useEffect(() => {
    if (!result && !pending) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [result, pending]);

  const waiting = !!pending && now - pending.at < WAIT_MS;
  const shown = result && now - result.at < RESULT_MS ? result : null;
  const give = (item: string) => {
    if (waiting) return;
    const key = newKey();
    setPending({ key, at: Date.now() });
    setNow(Date.now());
    store.set({ giftResult: null });
    world.send({ t: 'gift', npcId, item, key });
  };

  return (
    <details
      className="talk-gift"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <Gift size={14} aria-hidden /> {t('gift.title', { name })}
        {hearts !== undefined && (
          <span className="muted small"> · {t('gift.hearts', { count: hearts, max: 10 })}</span>
        )}
      </summary>
      {stacks.length === 0 ? (
        <p className="muted small">{t('gift.empty')}</p>
      ) : (
        <ul className="gift-list" aria-label={t('gift.listLabel', { name })}>
          {stacks.map(([key, n]) => {
            const item = t(`worlds.item.${baseItemOf(key)}`);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="btn secondary small-btn"
                  disabled={waiting}
                  aria-label={t('gift.giveLabel', { item, name, count: n })}
                  onClick={() => give(key)}
                >
                  {item} <span className="muted">×{n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="small" role="status" aria-live="polite">
        {shown
          ? shown.ok
            ? t(`gift.taste.${shown.taste ?? 'neutral'}`, { name })
            : t(`gift.refused.${shown.reason ?? 'invalid'}`, { name })
          : waiting
            ? t('gift.sending')
            : ''}
      </p>
      <p className="muted small">{t('gift.rules', { name })}</p>
    </details>
  );
}
