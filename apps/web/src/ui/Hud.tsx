import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, VolumeX, Users } from 'lucide-react';
import { zoneName } from '../game/controller';
import { store, useStore } from '../state/store';
import { media } from '../media/MediaManager';
import { placeOfWorldId, worldCardText } from '../worlds/card';

/** Room name (bottom-right), who-can-hear hint, banners and the screen-reader live region (P6.6). */
export function Hud() {
  const { t } = useTranslation();
  const zone = useStore((s) => s.myZone);
  // FIX-1: inside a personal world the card names the world; the office zone is stale there
  const worldId = useStore((s) => s.worldId);
  const worldOwner = useStore((s) => s.worldOwner);
  const conn = useStore((s) => s.conn);
  const toast = useStore((s) => s.toast);
  const mediaError = useStore((s) => s.mediaError);
  const peers = useStore((s) => s.peers);
  const profiles = useStore((s) => s.profiles);
  const spaceName = useStore((s) => s.spaceName);
  const autoAudioOnly = useStore((s) => s.autoAudioOnly);
  const sfu = useStore((s) => s.sfu);
  const [announce, setAnnounce] = useState('');
  const prevPeers = useRef<string[]>([]);
  const prevZone = useRef<string | undefined>(undefined);
  void store;

  const card = worldId !== null ? worldCardText(placeOfWorldId(worldId), worldOwner) : null;
  const cardTitle = card ? t(card.titleKey, card.titleVars) : null;

  useEffect(() => {
    const zid = zone?.id ?? null;
    // entering or leaving a world changes the place as much as walking into a pod does
    const place = `${zid ?? ''}|${worldId ?? ''}`;
    if (prevZone.current !== undefined && prevZone.current !== place)
      setAnnounce(t('a11y.entered', { place: cardTitle ?? zoneName(zid) }));
    prevZone.current = place;
  }, [zone, worldId, cardTitle, t]);

  useEffect(() => {
    const added = peers.filter((p) => !prevPeers.current.includes(p));
    const removed = prevPeers.current.filter((p) => !peers.includes(p));
    const names = (ids: string[]) =>
      ids
        .map((id) => profiles[id]?.name)
        .filter(Boolean)
        .join(', ');
    if (added.length) setAnnounce(t('a11y.nearby', { names: names(added) }));
    else if (removed.length && names(removed))
      setAnnounce(t('a11y.left', { names: names(removed) }));
    prevPeers.current = peers;
  }, [peers, profiles, t]);

  // inside a world the card is the world's own, whatever the office zone was when I entered
  const kind = card ? 'world' : zone?.kind;
  const hearHint = card
    ? t(card.hintKey)
    : kind === 'private'
      ? t('zone.hintPrivate')
      : kind === 'desk'
        ? t('zone.hintDesk')
        : kind === 'quiet'
          ? t('zone.hintQuiet')
          : kind === 'portal'
            ? t('zone.hintPortal')
            : t('zone.hintFloor');

  return (
    <>
      {(kind === 'private' || kind === 'desk' || kind === 'world') && (
        <div className="private-frame" aria-hidden />
      )}
      <div className={`room-name${kind === 'world' ? ' in-world' : ''}`} role="status">
        {spaceName && <span className="room-space">{spaceName}</span>}
        <span className="room-title">
          {kind === 'private' || kind === 'desk' || kind === 'world' ? (
            <Lock size={14} aria-hidden />
          ) : kind === 'quiet' ? (
            <VolumeX size={14} aria-hidden />
          ) : (
            <Users size={14} aria-hidden />
          )}
          {cardTitle ?? zoneName(zone?.id)}
        </span>
        <span className="room-hint">{hearHint}</span>
      </div>
      {(conn === 'reconnecting' || conn === 'connecting') && (
        <div className="banner warn" role="status">
          {t(conn === 'reconnecting' ? 'conn.reconnecting' : 'conn.connecting')}
        </div>
      )}
      {conn === 'lost' && (
        <div className="banner error" role="alert">
          {t('conn.lost')}{' '}
          <button type="button" className="link" onClick={() => location.reload()}>
            {t('conn.reload')}
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {t(toast.key, toast.vars)}
        </div>
      )}
      {sfu === 'lost' && (
        <div className="banner warn" role="status">
          {t('media.sfuLost')}
        </div>
      )}
      {autoAudioOnly && (
        <div className="banner warn quality" role="status">
          {t('quality.banner')}{' '}
          <button type="button" className="link" onClick={() => media.restoreVideo()}>
            {t('quality.restore')}
          </button>
        </div>
      )}
      {mediaError && (
        <div className="banner error media-error" role="alert">
          {t(`media.${mediaError}`)}{' '}
          <button type="button" className="link" onClick={() => store.set({ mediaError: null })}>
            {t('common.dismiss')}
          </button>
        </div>
      )}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </>
  );
}
