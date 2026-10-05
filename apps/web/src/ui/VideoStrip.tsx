import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MicOff, Minimize2, Maximize2, MonitorUp } from 'lucide-react';
import { avatarUrl } from '../game/textures';
import { useStore, type Attach } from '../state/store';

/** A video from a stream, or attached through the SFU SDK (adaptive quality follows the tile). */
function VideoEl({
  stream,
  attach,
  mirrored,
  fit,
}: {
  stream?: MediaStream;
  attach?: Attach;
  mirrored?: boolean;
  /** screens are letterboxed, faces fill the tile */
  fit?: 'contain';
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (attach) return attach(el);
    if (stream && el.srcObject !== stream) el.srcObject = stream;
  }, [stream, attach]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`${mirrored ? 'mirrored' : ''}${fit ? ' fit-contain' : ''}`}
    />
  );
}

export function VideoStrip() {
  const { t } = useTranslation();
  const peers = useStore((s) => s.peers);
  const remote = useStore((s) => s.remote);
  const profiles = useStore((s) => s.profiles);
  const nearest = useStore((s) => s.nearest);
  const me = useStore((s) => s.me);
  const cam = useStore((s) => s.cam);
  const mic = useStore((s) => s.mic);
  const local = useStore((s) => s.localStream);
  const speakingSelf = useStore((s) => s.speakingSelf);
  const cap = useStore((s) => s.config?.videoCap ?? 9);
  const audioOnly = useStore((s) => s.settings.audioOnly || s.autoAudioOnly);
  const talking = useStore((s) => s.talking);
  const sharing = useStore((s) => s.screen);
  const myScreen = useStore((s) => s.screenStream);
  const [collapsed, setCollapsed] = useState(false);
  const [enlarged, setEnlarged] = useState<string | null>(null);

  const linked = peers
    .filter((id) => profiles[id])
    .sort((a, b) => nearest.indexOf(a) - nearest.indexOf(b));
  if (!linked.length && !sharing) return null;
  const shown = linked.slice(0, cap);
  // shared screens of linked people (their profile says so and I receive it), mine first
  const screens = linked.filter((id) => profiles[id]?.screen && remote[id]?.screen);

  const tile = (id: string, isMe: boolean) => {
    const p = profiles[id];
    if (!p) return null;
    const r = remote[id];
    // audio-only: no video either way (P3.9); a peer asking for low bandwidth sends none to me
    const hasVideo = !audioOnly && (isMe ? cam && !!local : !!(r?.hasVideo && p.cam && !p.lowBw));
    const speaking = isMe ? speakingSelf : !!r?.speaking;
    const micOn = isMe ? mic : p.mic;
    return (
      <li
        key={id}
        className={`tile${speaking ? ' speaking' : ''}${enlarged === id ? ' enlarged' : ''}`}
      >
        <button
          type="button"
          className="tile-btn"
          onClick={() => setEnlarged(enlarged === id ? null : id)}
          aria-label={t(enlarged === id ? 'video.shrink' : 'video.enlarge', { name: p.name })}
        >
          {hasVideo && !collapsed ? (
            <VideoEl
              stream={isMe ? local! : r!.stream}
              attach={isMe ? undefined : r?.attach}
              mirrored={isMe}
            />
          ) : (
            <img src={avatarUrl(p.avatar, 2)} alt="" className="pixel tile-avatar" />
          )}
          <span className="tile-name">
            {!micOn && <MicOff size={12} aria-label={t('people.micOff')} />}{' '}
            {isMe ? t('people.you') : p.name}
            {micOn && p.ptt && (
              <span
                className={`ptt-badge${isMe && talking ? ' live' : ''}`}
                title={t('video.pttHint')}
              >
                {t('video.ptt')}
              </span>
            )}
          </span>
        </button>
      </li>
    );
  };

  const screenTile = (id: string, isMe: boolean) => {
    const p = profiles[id];
    if (!p) return null;
    const key = `${id}:screen`;
    const label = isMe ? t('video.myScreen') : t('video.screenOf', { name: p.name });
    return (
      <li key={key} className={`tile screen-tile${enlarged === key ? ' enlarged' : ''}`}>
        <button
          type="button"
          className="tile-btn"
          onClick={() => setEnlarged(enlarged === key ? null : key)}
          aria-label={t(enlarged === key ? 'video.shrink' : 'video.enlarge', { name: label })}
        >
          {!collapsed &&
            (isMe ? (
              myScreen && <VideoEl stream={myScreen} fit="contain" />
            ) : (
              <VideoEl attach={remote[id]?.screen?.attach} fit="contain" />
            ))}
          <span className="tile-name">
            <MonitorUp size={12} aria-hidden /> {label}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section
      className={`video-strip${collapsed ? ' collapsed' : ''}`}
      aria-label={t('video.label')}
    >
      <ul>
        {me && sharing && screenTile(me, true)}
        {screens.map((id) => screenTile(id, false))}
        {me && tile(me, true)}
        {shown.map((id) => tile(id, false))}
      </ul>
      {linked.length > shown.length && (
        <span className="muted small more">
          {t('video.more', { count: linked.length - shown.length })}
        </span>
      )}
      <button
        type="button"
        className="icon-btn strip-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={t(collapsed ? 'video.expand' : 'video.collapse')}
        aria-pressed={collapsed}
      >
        {collapsed ? <Maximize2 size={14} aria-hidden /> : <Minimize2 size={14} aria-hidden />}
      </button>
    </section>
  );
}
