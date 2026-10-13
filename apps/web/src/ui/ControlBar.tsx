import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Armchair,
  Building2,
  CircleHelp,
  Ellipsis,
  FileText,
  Hammer,
  Home,
  Map as MapIcon,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PanelRight,
  Settings as SettingsIcon,
  ShieldCheck,
  Smile,
  SlidersHorizontal,
  UserCog,
  Video,
  VideoOff,
} from 'lucide-react';
import { EMOTES, EMOTE_GLYPH, STATUSES, can, type Status } from '@agora/shared';
import { avatarUrl } from '../game/textures';
import { media } from '../media/MediaManager';
import { world } from '../net/client';
import { store, useStore } from '../state/store';
import { setBuild } from '../game/build';
import { Dialog } from './common';
import { useCompactLayout, useTouchControls } from './layout';

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: PointerEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && onOut();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onOut();
    window.addEventListener('pointerdown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('pointerdown', h);
      window.removeEventListener('keydown', k);
    };
  }, [ref, onOut, active]);
}

/** State and permissions both control bars need. */
function useControls() {
  const canShare = useStore(
    (s) =>
      // screen sharing needs the SFU backend (P7.1, ADR-031) and browser support
      s.config?.mediaBackend === 'livekit' &&
      s.config.flags.screenShare !== false &&
      !!navigator.mediaDevices?.getDisplayMedia,
  );
  return {
    mic: useStore((s) => s.mic),
    ptt: useStore((s) => s.settings.pushToTalk),
    pttKey: useStore((s) => s.settings.pttKey),
    talking: useStore((s) => s.talking),
    cam: useStore((s) => s.cam),
    screen: useStore((s) => s.screen),
    canShare,
    me: useStore((s) => (s.me ? s.profiles[s.me] : undefined)),
    status: useStore((s) => s.status),
    statusMsg: useStore((s) => s.statusMsg),
    flags: useStore((s) => s.config?.flags),
    panelOpen: useStore((s) => s.panelOpen),
    myDesk: useStore((s) => s.myDesk),
    canBuild: useStore((s) => s.builder && s.config?.flags.builder !== false),
    /** world tuning panel (P17.12): behind the `worlds` flag, for builders and in development */
    canTune: useStore((s) => s.config?.flags.worlds === true && (s.builder || import.meta.env.DEV)),
    building: useStore((s) => !!s.build),
    spaceName: useStore((s) => s.spaceName),
    /** the owner's People page (invites, accounts), passkey mode only */
    canPeople: useStore((s) => s.passkeyMode && can(s.role, 'invite.manage')),
  };
}

const setStatus = (s: Status, msg: string) => {
  store.set({ status: s, statusMsg: msg });
  world.send({ t: 'status', status: s, msg });
};

function EmoteButtons({ onPick }: { onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      {EMOTES.map((e, i) => (
        <button
          key={e}
          type="button"
          role="menuitem"
          className="emote-btn"
          onClick={() => {
            world.send({ t: 'emote', emote: e });
            onPick();
          }}
          aria-label={`${t(`emote.${e}`)} (${i + 1})`}
          title={`${t(`emote.${e}`)} (${i + 1})`}
        >
          <span aria-hidden>{EMOTE_GLYPH[e]}</span>
        </button>
      ))}
    </>
  );
}

/** Status choices and the status message (menu on desktop, a section of the More sheet on phones). */
function StatusChoices({ onDone, role = 'menu' }: { onDone: () => void; role?: string }) {
  const { t } = useTranslation();
  const status = useStore((s) => s.status);
  const statusMsg = useStore((s) => s.statusMsg);
  const [msgDraft, setMsgDraft] = useState(statusMsg);
  const item = role === 'menu' ? 'menuitemradio' : 'radio';
  return (
    <>
      <div
        className="status-choices"
        role={role === 'menu' ? undefined : 'radiogroup'}
        aria-label={role === 'menu' ? undefined : t('status.label')}
      >
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role={item}
            aria-checked={status === s}
            className="menu-item"
            onClick={() => setStatus(s, statusMsg)}
          >
            <span className={`status-dot ${s}`} aria-hidden /> {t(`status.${s}`)}
          </button>
        ))}
      </div>
      <form
        className="status-msg"
        onSubmit={(e) => {
          e.preventDefault();
          setStatus(status, msgDraft.trim());
          onDone();
        }}
      >
        <label className="field compact">
          <span className="small">{t('status.message')}</span>
          <input
            value={msgDraft}
            maxLength={80}
            enterKeyHint="done"
            onChange={(e) => setMsgDraft(e.target.value)}
            onBlur={() => msgDraft.trim() !== statusMsg && setStatus(status, msgDraft.trim())}
            placeholder={t('status.messagePlaceholder')}
          />
        </label>
      </form>
    </>
  );
}

export function ControlBar() {
  return useCompactLayout() ? <Dock /> : <DesktopBar />;
}

function MicCamButtons() {
  const { t } = useTranslation();
  const { mic, ptt, pttKey, talking, cam } = useControls();
  return (
    <>
      <button
        type="button"
        className={`ctrl${mic ? ' on' : ' off'}${talking ? ' talking' : ''}`}
        aria-pressed={mic}
        onClick={() => void media.setMic(!mic)}
        title={
          mic && ptt
            ? t('controls.pttHold', { key: t(`settings.key${pttKey}`) })
            : t(mic ? 'controls.micOff' : 'controls.micOn')
        }
      >
        {mic ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
        <span className="sr-only">{t('controls.mic')}</span>
      </button>
      <button
        type="button"
        className={`ctrl${cam ? ' on' : ' off'}`}
        aria-pressed={cam}
        onClick={() => void media.setCam(!cam)}
        title={t(cam ? 'controls.camOff' : 'controls.camOn')}
      >
        {cam ? <Video size={18} aria-hidden /> : <VideoOff size={18} aria-hidden />}
        <span className="sr-only">{t('controls.cam')}</span>
      </button>
    </>
  );
}

function EmoteMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="ctrl"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={t('controls.emotes')}
      >
        <Smile size={18} aria-hidden />
        <span className="sr-only">{t('controls.emotes')}</span>
      </button>
      {open && (
        <div className="menu emote-menu" role="menu">
          <EmoteButtons onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function DesktopBar() {
  const { t } = useTranslation();
  const c = useControls();
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  useOutside(statusRef, () => setStatusOpen(false), statusOpen);

  return (
    <nav className="control-bar" aria-label={t('controls.label')}>
      {c.me && (
        <button
          type="button"
          className="me-btn"
          onClick={() => store.set({ dialog: 'avatar' })}
          aria-label={t('controls.editAvatar')}
          title={t('controls.editAvatar')}
        >
          <img src={avatarUrl(c.me.avatar, 1)} alt="" width={32} height={40} className="pixel" />
          <span className="me-name">{c.me.name}</span>
        </button>
      )}
      {c.flags?.media !== false && (
        <>
          <MicCamButtons />
          {c.canShare && (
            <button
              type="button"
              className={`ctrl${c.screen ? ' on sharing' : ''}`}
              aria-pressed={c.screen}
              onClick={() => void media.setScreen(!c.screen)}
              title={t(c.screen ? 'controls.screenOff' : 'controls.screenOn')}
            >
              {c.screen ? (
                <MonitorOff size={18} aria-hidden />
              ) : (
                <MonitorUp size={18} aria-hidden />
              )}
              <span className="sr-only">{t('controls.screen')}</span>
            </button>
          )}
        </>
      )}
      <EmoteMenu />
      <div className="menu-wrap" ref={statusRef}>
        <button
          type="button"
          className="ctrl status-ctrl"
          aria-haspopup="true"
          aria-expanded={statusOpen}
          onClick={() => setStatusOpen(!statusOpen)}
        >
          <span className={`status-dot ${c.status}`} aria-hidden />
          <span>{t(`status.${c.status}`)}</span>
        </button>
        {statusOpen && (
          <div className="menu status-menu" role="menu">
            <StatusChoices onDone={() => setStatusOpen(false)} />
          </div>
        )}
      </div>
      {c.myDesk && (
        <button
          type="button"
          className="ctrl"
          onClick={() => store.set({ navRequest: { kind: 'desk' } })}
          title={`${t('desk.goto')} (H)`}
        >
          <Home size={18} aria-hidden />
          <span className="sr-only">{t('desk.goto')}</span>
        </button>
      )}
      <button
        type="button"
        className="ctrl"
        onClick={() => store.set({ dialog: 'desk' })}
        title={c.myDesk ? t('desk.title') : t('desk.none')}
      >
        <Armchair size={18} aria-hidden />
        <span className="sr-only">{t('desk.title')}</span>
      </button>
      {c.canTune && (
        <button
          type="button"
          className="ctrl"
          onClick={() => store.set({ dialog: 'worldTuning' })}
          title={t('worlds.tuning.open')}
        >
          <SlidersHorizontal size={18} aria-hidden />
          <span className="sr-only">{t('worlds.tuning.open')}</span>
        </button>
      )}
      {c.canBuild && (
        <button
          type="button"
          className={`ctrl${c.building ? ' on' : ''}`}
          aria-pressed={c.building}
          onClick={() => setBuild(!c.building)}
          title={t('build.open')}
        >
          <Hammer size={18} aria-hidden />
          <span className="sr-only">{t('build.title')}</span>
        </button>
      )}
      {c.flags?.spaces !== false && (
        <button
          type="button"
          className="ctrl"
          onClick={() => store.set({ dialog: 'spaces' })}
          title={c.spaceName ? t('spaces.buttonNamed', { name: c.spaceName }) : t('spaces.title')}
        >
          <Building2 size={18} aria-hidden />
          <span className="sr-only">{t('spaces.title')}</span>
        </button>
      )}
      {c.canPeople && (
        <button
          type="button"
          className="ctrl"
          onClick={() => store.set({ dialog: 'people' })}
          title={t('admin.button')}
        >
          <UserCog size={18} aria-hidden />
          <span className="sr-only">{t('admin.button')}</span>
        </button>
      )}
      <button
        type="button"
        className="ctrl"
        onClick={() => store.set({ dialog: 'settings' })}
        title={t('settings.title')}
      >
        <SettingsIcon size={18} aria-hidden />
        <span className="sr-only">{t('settings.title')}</span>
      </button>
      <button
        type="button"
        className="ctrl"
        onClick={() => store.set({ dialog: 'shortcuts' })}
        title={t('shortcuts.title')}
      >
        <CircleHelp size={18} aria-hidden />
        <span className="sr-only">{t('shortcuts.title')}</span>
      </button>
      <button
        type="button"
        className="ctrl"
        aria-pressed={c.panelOpen}
        onClick={() => store.set({ panelOpen: !c.panelOpen })}
        title={t('controls.panel')}
      >
        <PanelRight size={18} aria-hidden />
        <span className="sr-only">{t('controls.panel')}</span>
      </button>
    </nav>
  );
}

/**
 * Phone and small-tablet dock (P8.2): one row with what you reach for all the time
 * (you, mic, camera, reactions, chat), everything else in the More sheet.
 */
function Dock() {
  const { t } = useTranslation();
  const c = useControls();
  const unread = useStore((s) => s.unread.nearby + s.unread.everyone);
  const [more, setMore] = useState(false);
  return (
    <>
      <nav className="control-bar dock" aria-label={t('controls.label')}>
        {c.me && (
          <button
            type="button"
            className="me-btn"
            onClick={() => store.set({ dialog: 'avatar' })}
            aria-label={t('controls.editAvatar')}
          >
            <img src={avatarUrl(c.me.avatar, 1)} alt="" width={32} height={40} className="pixel" />
            <span className={`status-dot ${c.status} me-status`} aria-hidden />
          </button>
        )}
        {c.flags?.media !== false && <MicCamButtons />}
        <EmoteMenu />
        <button
          type="button"
          className={`ctrl${c.panelOpen ? ' active' : ''}`}
          aria-pressed={c.panelOpen}
          onClick={() => store.set({ panelOpen: !c.panelOpen })}
        >
          <MessageSquare size={18} aria-hidden />
          <span className="sr-only">{t('controls.panel')}</span>
          {unread > 0 && !c.panelOpen && (
            <span className="badge dock-badge" aria-label={t('chat.unread', { count: unread })}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
        <button
          type="button"
          className="ctrl"
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={() => setMore(true)}
        >
          <Ellipsis size={18} aria-hidden />
          <span className="sr-only">{t('controls.more')}</span>
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </>
  );
}

function SheetAction({
  icon,
  label,
  onClick,
  pressed,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className={`sheet-action${pressed ? ' on' : ''}`}
      onClick={onClick}
      aria-pressed={pressed}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const c = useControls();
  const touch = useTouchControls();
  const minimap = useStore((s) => s.minimap);
  // FIX-1: no office minimap inside a personal world (App.tsx hides it there too)
  const inWorld = useStore((s) => s.worldId !== null);
  const showMinimap = useStore((s) => s.config?.flags.minimap !== false) && !inWorld;
  /** close the sheet, then act (opening another dialog replaces this one) */
  const go = (f: () => void) => () => {
    onClose();
    f();
  };
  return (
    <Dialog title={t('controls.moreTitle')} onClose={onClose} className="sheet more-sheet">
      <section className="sheet-section" aria-labelledby="more-status">
        <h3 id="more-status" className="h-small">
          {t('status.label')}
        </h3>
        <StatusChoices onDone={onClose} role="radiogroup" />
      </section>
      <div className="sheet-grid">
        {c.me && (
          <SheetAction
            icon={<UserCog size={20} aria-hidden />}
            label={t('controls.editAvatar')}
            onClick={go(() => store.set({ dialog: 'avatar' }))}
          />
        )}
        {c.myDesk && (
          <SheetAction
            icon={<Home size={20} aria-hidden />}
            label={t('desk.goto')}
            onClick={go(() => store.set({ navRequest: { kind: 'desk' } }))}
          />
        )}
        <SheetAction
          icon={<Armchair size={20} aria-hidden />}
          label={t('desk.title')}
          onClick={go(() => store.set({ dialog: 'desk' }))}
        />
        {showMinimap && (
          <SheetAction
            icon={<MapIcon size={20} aria-hidden />}
            label={t('shortcuts.minimap')}
            pressed={minimap}
            onClick={go(() => store.set({ minimap: !minimap }))}
          />
        )}
        {c.flags?.media !== false && c.canShare && (
          <SheetAction
            icon={
              c.screen ? <MonitorOff size={20} aria-hidden /> : <MonitorUp size={20} aria-hidden />
            }
            label={t(c.screen ? 'controls.screenOff' : 'controls.screenOn')}
            pressed={c.screen}
            onClick={go(() => void media.setScreen(!c.screen))}
          />
        )}
        {c.flags?.spaces !== false && (
          <SheetAction
            icon={<Building2 size={20} aria-hidden />}
            label={t('spaces.title')}
            onClick={go(() => store.set({ dialog: 'spaces' }))}
          />
        )}
        {c.canBuild && (
          <SheetAction
            icon={<Hammer size={20} aria-hidden />}
            label={t('build.title')}
            pressed={c.building}
            onClick={go(() => setBuild(!c.building))}
          />
        )}
        {c.canPeople && (
          <SheetAction
            icon={<UserCog size={20} aria-hidden />}
            label={t('admin.button')}
            onClick={go(() => store.set({ dialog: 'people' }))}
          />
        )}
        <SheetAction
          icon={<SettingsIcon size={20} aria-hidden />}
          label={t('settings.title')}
          onClick={go(() => store.set({ dialog: 'settings' }))}
        />
        <SheetAction
          icon={<CircleHelp size={20} aria-hidden />}
          label={t(touch ? 'touch.helpTitle' : 'shortcuts.title')}
          onClick={go(() => store.set({ dialog: 'shortcuts' }))}
        />
        <SheetAction
          icon={<ShieldCheck size={20} aria-hidden />}
          label={t('privacy.title')}
          onClick={go(() => store.set({ dialog: 'privacy' }))}
        />
        <SheetAction
          icon={<FileText size={20} aria-hidden />}
          label={t('credits.title')}
          onClick={go(() => store.set({ dialog: 'credits' }))}
        />
      </div>
    </Dialog>
  );
}
