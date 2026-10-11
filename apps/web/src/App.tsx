import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMOTES, randomAvatar, type Avatar } from '@agora/shared';
import { GameView } from './game/GameView';
import { isTyping } from './game/input';
import { media } from './media/MediaManager';
import { world } from './net/client';
import { store, useStore } from './state/store';
import { AvatarEditor } from './ui/AvatarEditor';
import { ControlBar } from './ui/ControlBar';
import { Hud } from './ui/Hud';
import { Credits, Privacy, Shortcuts } from './ui/Info';
import { Login } from './ui/Login';
import { Settings } from './ui/Settings';
import { SidePanel } from './ui/SidePanel';
import { VideoStrip } from './ui/VideoStrip';
import { DeskDialog } from './ui/DeskDialog';
import { WorldTuning } from './worlds/WorldTuning';
import { WorldHudInWorld } from './worlds/ui/WorldHudInWorld';
import { Minimap, zoomStep } from './ui/Minimap';
import { PromptBar } from './ui/PromptBar';
import { TalkBox } from './ui/TalkBox';
import { BuildPanel, BuildResetDialog } from './ui/BuildPanel';
import { setBuild } from './game/build';
import { DEFAULT_SPACE } from '@agora/shared';
import { currentRoute, goToSpace, rememberSpace } from './route';
import { Join } from './ui/Join';
import { Claim } from './ui/Claim';
import { Account } from './ui/Account';
import { People } from './ui/People';
import { SpaceSettingsDialog, SpacesDialog } from './ui/Spaces';
import { DeviceCheck, type JoinChoice } from './ui/DeviceCheck';
import { api } from './net/api';
import { TouchControls } from './ui/TouchControls';
import { COMPACT_QUERY, matches, useCompactLayout, useTouchControls } from './ui/layout';
import type { PlatformRole, SpaceDetail } from '@agora/shared';

type Phase = 'boot' | 'login' | 'avatar' | 'precheck' | 'world';

const loadAvatar = (): Avatar | null => {
  try {
    const raw = localStorage.getItem('agora.avatar');
    return raw ? (JSON.parse(raw) as Avatar) : null;
  } catch {
    return null;
  }
};
const saveAvatar = (a: Avatar) => {
  try {
    localStorage.setItem('agora.avatar', JSON.stringify(a));
  } catch {
    /* ignore */
  }
};

function useShortcuts(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping() || store.get().dialog) return;
      const building = !!store.get().build;
      if (e.key === 'b' || e.key === 'B') {
        if (store.get().builder) setBuild(!building);
        return;
      }
      // build mode owns Enter, Space, arrows, Q/E/I/G/O and Escape
      if (building && e.key === 'Enter') return;
      // Enter on a focused <summary> (the characters' brain view) opens it, not the chat
      const target = e.target instanceof Element ? e.target : null;
      if (e.key === 'Enter' && target?.closest('summary')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= EMOTES.length) world.send({ t: 'emote', emote: EMOTES[n - 1]! });
      else if (e.key === 'm' || e.key === 'M') void media.setMic(!store.get().mic);
      else if (e.key === 'v' || e.key === 'V') void media.setCam(!store.get().cam);
      else if (e.key === 'p' || e.key === 'P') store.set({ panelOpen: true, panel: 'people' });
      else if (e.key === 'h' || e.key === 'H') {
        if (store.get().myDesk) store.set({ navRequest: { kind: 'desk' } });
      } else if (e.key === 'n' || e.key === 'N') store.set({ minimap: !store.get().minimap });
      else if (e.key === '+' || e.key === '=') zoomStep(1);
      else if (e.key === '-' || e.key === '_') zoomStep(-1);
      else if (e.key === '?') store.set({ dialog: 'shortcuts' });
      else if (e.key === 'Enter') {
        store.set({ panelOpen: true, panel: 'chat' });
        setTimeout(() => document.getElementById('chat-input')?.focus(), 0);
        e.preventDefault();
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

export function App() {
  const [route] = useState(currentRoute);
  if (route.kind === 'join') return <Join token={route.token} />;
  if (route.kind === 'ticket') return <Claim token={route.token} />;
  return <SpaceApp slug={route.slug} />;
}

function SpaceApp({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('boot');
  const [user, setUser] = useState<{ name: string; avatar: Avatar | null } | null>(null);
  const dialog = useStore((s) => s.dialog);
  const conn = useStore((s) => s.conn);
  const me = useStore((s) => (s.me ? s.profiles[s.me] : undefined));
  const showMinimap = useStore((s) => s.config?.flags.minimap !== false);
  const spaceName = useStore((s) => s.spaceName);
  const compact = useCompactLayout();
  const touch = useTouchControls();
  /** media flag from the server, known before the world connects */
  const mediaOn = useRef(true);
  /** mic/cam chosen in the device check, applied once the world is online */
  const choice = useRef<JoinChoice | null>(null);
  /** after the avatar editor: device check (when on and media is enabled), then the world */
  const enter = useCallback(() => {
    const s = store.get();
    setPhase(s.settings.precheck && mediaOn.current && s.conn !== 'denied' ? 'precheck' : 'world');
  }, []);

  const boot = useCallback(async () => {
    const r = await fetch('/api/me', { credentials: 'same-origin' }).catch(() => null);
    if (!r || !r.ok) return setPhase('login');
    const u = (await r.json()) as {
      uid: string;
      name: string;
      avatar: Avatar | null;
      builderCode?: boolean;
      adminCode?: boolean;
      admin?: boolean;
      remembered?: boolean;
      media?: boolean;
      role?: PlatformRole;
      invitedName?: string | null;
      passkeys?: boolean;
    };
    store.set({
      builderCodeAvailable: !!u.builderCode,
      adminCodeAvailable: !!u.adminCode,
      admin: !!u.admin,
      remembered: !!u.remembered,
      role: u.role ?? 'member',
      invitedName: u.invitedName ?? null,
      passkeyMode: !!u.passkeys,
      uid: u.uid,
      space: slug,
    });
    mediaOn.current = u.media !== false;
    // Know the space (name, or that it is out of reach) before the device check.
    const sp = await api<SpaceDetail>('GET', `/api/spaces/${encodeURIComponent(slug)}`);
    if (sp.data) store.set({ spaceName: sp.data.name });
    else if (sp.status === 403 || sp.status === 404)
      store.set({ conn: 'denied', denied: sp.status === 404 ? 'not_found' : 'forbidden' });
    const avatar = u.avatar ?? loadAvatar();
    setUser({ name: u.name, avatar });
    if (store.get().conn === 'denied') setPhase('world');
    else if (!avatar) setPhase('avatar');
    else enter();
  }, [slug, enter]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // phones start with the world in view: panel and minimap closed (P8.2)
  useEffect(() => {
    if (phase === 'world' && matches(COMPACT_QUERY))
      store.set({ panelOpen: false, minimap: false });
  }, [phase]);

  useEffect(() => {
    if (phase !== 'world' || !user?.avatar || store.get().conn === 'denied') return;
    media.start();
    // closing or reloading the tab frees the seat right away
    const bye = () => world.leave();
    window.addEventListener('pagehide', bye);
    void world
      .start(user.avatar, slug)
      .catch(() => store.get().conn !== 'denied' && store.set({ conn: 'lost' }));
    return () => {
      window.removeEventListener('pagehide', bye);
      world.stop();
      media.stop();
    };
  }, [phase, user?.avatar, slug]);

  // the last space you were in is where `/` takes you next time
  useEffect(() => {
    if (conn !== 'online') return;
    rememberSpace(slug);
    const c = choice.current;
    choice.current = null;
    if (c?.mic) void media.setMic(true);
    if (c?.cam) void media.setCam(true);
    // (re)announce mic, cam, push-to-talk and audio-only: the server starts from "off"
    media.announce();
  }, [conn, slug]);

  useShortcuts(phase === 'world');

  const logout = async (forget = false) => {
    world.stop();
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forget }),
    });
    store.reset();
    location.reload();
  };

  if (phase === 'boot') return <div className="boot" aria-busy="true" />;
  if (phase === 'login') return <Login onDone={() => void boot()} />;
  if (phase === 'precheck')
    return (
      <DeviceCheck
        spaceName={spaceName}
        onJoin={(c) => {
          choice.current = c;
          setPhase('world');
        }}
      />
    );
  if (phase === 'avatar' && user)
    return (
      <main className="login">
        <AvatarEditor
          firstTime
          initial={randomAvatar()}
          name={user.name}
          onClose={() => {
            const a = randomAvatar();
            saveAvatar(a);
            setUser({ ...user, avatar: a });
            enter();
          }}
          onSave={(a, name) => {
            saveAvatar(a);
            media.unlockAudio();
            setUser({ name, avatar: a });
            enter();
            if (name !== user.name)
              setTimeout(() => world.send({ t: 'profile', name, avatar: a }), 1500);
          }}
        />
      </main>
    );

  return (
    <div
      className={`app${compact ? ' compact' : ''}${touch ? ' touch' : ''}`}
      onPointerDown={() => media.unlockAudio()}
    >
      <h1 className="sr-only">Agora</h1>
      {store.get().map || conn !== 'idle' ? <GameViewWhenReady /> : null}
      <VideoStrip />
      <SidePanel />
      <BuildPanel />
      <ControlBar />
      <Hud />
      <WorldHudInWorld />
      <PromptBar />
      <TalkBox />
      {showMinimap && <Minimap />}
      {touch && <TouchControls />}
      {conn === 'full' && (
        <div className="dialog-backdrop">
          <div className="dialog" role="alertdialog" aria-labelledby="full-title">
            <h2 id="full-title">{t('conn.fullTitle')}</h2>
            <p>{t('conn.full')}</p>
            <button type="button" className="btn primary" onClick={() => location.reload()}>
              {t('conn.retry')}
            </button>
          </div>
        </div>
      )}
      {conn === 'denied' && <DeniedDialog slug={slug} />}
      {dialog === 'spaces' && <SpacesDialog onClose={() => store.set({ dialog: null })} />}
      {dialog === 'spaceSettings' && (
        <SpaceSettingsDialog onClose={() => store.set({ dialog: null })} />
      )}
      {dialog === 'avatar' && me && (
        <AvatarEditor
          initial={me.avatar}
          name={me.name}
          onClose={() => store.set({ dialog: null })}
          onSave={(a, name) => {
            saveAvatar(a);
            world.send({ t: 'profile', name, avatar: a });
            store.set({ dialog: null });
          }}
        />
      )}
      {dialog === 'credits' && <Credits onClose={() => store.set({ dialog: null })} />}
      {dialog === 'account' && <Account onClose={() => store.set({ dialog: null })} />}
      {dialog === 'people' && <People onClose={() => store.set({ dialog: null })} />}
      {dialog === 'desk' && <DeskDialog onClose={() => store.set({ dialog: null })} />}
      {dialog === 'worldTuning' && <WorldTuning onClose={() => store.set({ dialog: null })} />}
      {dialog === 'privacy' && <Privacy onClose={() => store.set({ dialog: null })} />}
      {dialog === 'shortcuts' && <Shortcuts onClose={() => store.set({ dialog: null })} />}
      {dialog === 'buildReset' && <BuildResetDialog onClose={() => store.set({ dialog: null })} />}
      {dialog === 'settings' && (
        <Settings
          onClose={() => store.set({ dialog: null })}
          onLogout={(forget) => void logout(forget)}
        />
      )}
      {/* on phones these live in the More sheet */}
      <footer className="footer-links" hidden={compact}>
        <button type="button" className="link" onClick={() => store.set({ dialog: 'privacy' })}>
          {t('privacy.title')}
        </button>
        <button type="button" className="link" onClick={() => store.set({ dialog: 'credits' })}>
          {t('credits.title')}
        </button>
      </footer>
    </div>
  );
}

/** This space does not exist, or it is invite-only and I am not a member (P2.3). */
function DeniedDialog({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const why = useStore((s) => s.denied);
  const home = slug === DEFAULT_SPACE ? null : DEFAULT_SPACE;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-labelledby="denied-title">
        <h2 id="denied-title">
          {t(why === 'not_found' ? 'spaces.notFoundTitle' : 'spaces.forbiddenTitle')}
        </h2>
        <p>{t(why === 'not_found' ? 'spaces.notFound' : 'spaces.forbidden')}</p>
        {home && (
          <button type="button" className="btn primary" onClick={() => goToSpace(home)}>
            {t('spaces.goHome')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Mount Phaser only once the map and my id are known. */
function GameViewWhenReady() {
  const ready = useStore((s) => !!s.map && !!s.me);
  const gen = useStore((s) => s.mapGen);
  return ready ? <GameView key={gen} /> : <div className="world-canvas loading" />;
}
