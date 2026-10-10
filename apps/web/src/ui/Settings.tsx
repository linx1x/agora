import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { world } from '../net/client';
import { stopNpcVoices } from '../media/npcVoice';
import { media } from '../media/MediaManager';
import { Dialog, LanguageSwitcher } from './common';
import { useTouchControls } from './layout';
import { saveSettings, store, useStore, type Settings as S } from '../state/store';

type BoolKey = { [K in keyof S]: S[K] extends boolean ? K : never }[keyof S];
/** Push-to-talk keys that no other shortcut uses (P3.8). */
export const PTT_KEYS = [
  'Space',
  'KeyT',
  'KeyF',
  'Backquote',
  'ShiftRight',
  'ControlRight',
] as const;

export function Settings({
  onClose,
  onLogout,
}: {
  onClose: () => void;
  /** forget = also drop this browser's remembered identity */
  onLogout: (forget: boolean) => void;
}) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const settings = useStore((s) => s.settings);
  const npcTalkOn = useStore((s) => s.config?.flags.npcTalk === true);
  const npcVoiceOn = useStore((s) => s.config?.flags.npcVoice === true);
  const canUnlock = useStore(
    (s) => (s.builderCodeAvailable && !s.builder) || (s.adminCodeAvailable && !s.admin),
  );
  const remembered = useStore((s) => s.remembered);
  const passkeyMode = useStore((s) => s.passkeyMode);
  const uid = useStore((s) => s.uid);
  const touch = useTouchControls();
  const [code, setCode] = useState('');
  const [codeMsg, setCodeMsg] = useState('');
  const unlock = async () => {
    const r = await fetch('/api/builder/unlock', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }).catch(() => null);
    if (r?.ok) {
      const { admin } = (await r.json().catch(() => ({}))) as { admin?: boolean };
      setCodeMsg(t(admin ? 'build.unlockedAdmin' : 'build.unlocked'));
      // new realtime token carries the builder claim
      setTimeout(() => location.reload(), 600);
    } else setCodeMsg(t(r?.status === 429 ? 'toast.rateLimited' : 'build.unlockBad'));
  };
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);
  const of = (k: MediaDeviceKind) => devices.filter((d) => d.kind === k && d.deviceId);
  const sel = (
    kind: MediaDeviceKind,
    label: string,
    value: string | undefined,
    onChange: (id: string) => void,
  ) => {
    const list = of(kind);
    return (
      <label className="field">
        <span>{t(label)}</span>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={!list.length}
        >
          <option value="">{t('settings.default')}</option>
          {list.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${t(label)} ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <Dialog title={t('settings.title')} onClose={onClose}>
      <div className="stack">
        {sel(
          'audioinput',
          'settings.mic',
          media.micDeviceId,
          (id) => void media.switchDevice('mic', id),
        )}
        {sel(
          'videoinput',
          'settings.cam',
          media.camDeviceId,
          (id) => void media.switchDevice('cam', id),
        )}
        {'setSinkId' in HTMLMediaElement.prototype &&
          sel(
            'audiooutput',
            'settings.speaker',
            media.speakerDeviceId,
            (id) => void media.setSpeaker(id),
          )}
        <p className="muted small">{t('settings.devicesNote')}</p>
        {(
          [
            'lighting',
            'sounds',
            'autoSit',
            'precheck',
            'audioOnly',
            'pushToTalk',
            ...(touch ? ['joystick'] : []),
            ...(npcTalkOn ? ['npcBubbles'] : []),
            ...(npcVoiceOn ? ['npcVoices'] : []),
          ] as BoolKey[]
        ).map((k) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              checked={settings[k]}
              onChange={(e) => {
                const next = { ...settings, [k]: e.target.checked };
                saveSettings(next);
                store.set({ settings: next });
                if (k === 'npcVoices') {
                  world.send({ t: 'npc:voice', on: e.target.checked });
                  if (!e.target.checked) stopNpcVoices();
                }
              }}
            />
            <span>
              {t(`settings.${k}`)}
              <span className="muted small"> {t(`settings.${k}Hint`)}</span>
            </span>
          </label>
        ))}
        {settings.pushToTalk && !touch && (
          <label className="field compact">
            <span>{t('settings.pttKey')}</span>
            <select
              value={settings.pttKey}
              onChange={(e) => {
                const next = { ...settings, pttKey: e.target.value };
                saveSettings(next);
                store.set({ settings: next });
              }}
            >
              {PTT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`settings.key${k}`)}
                </option>
              ))}
            </select>
            <span className="muted small">{t('settings.pttKeyHint')}</span>
          </label>
        )}
        {canUnlock && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (code) void unlock();
            }}
          >
            <label className="field">
              <span>{t('build.unlock')}</span>
              <input
                type="password"
                autoComplete="off"
                value={code}
                maxLength={200}
                onChange={(e) => setCode(e.target.value)}
              />
              <span className="muted small">{t('build.unlockHint')}</span>
            </label>
            <button type="submit" className="btn secondary" disabled={!code}>
              {t('build.unlockBtn')}
            </button>
            <p className="small" role="status">
              {codeMsg}
            </p>
          </form>
        )}
        <div className="row-between">
          <span>{t('settings.language')}</span>
          <LanguageSwitcher />
        </div>
        {passkeyMode && (
          <button
            type="button"
            className="btn secondary"
            onClick={() => store.set({ dialog: 'account' })}
          >
            {t('account.open')}
          </button>
        )}
        <button type="button" className="btn secondary" onClick={() => onLogout(false)}>
          {t('settings.logout')}
        </button>
        {uid && (
          <p className="muted small">
            {t('settings.yourId')} <code>{uid}</code>
          </p>
        )}
        {remembered && (
          <>
            <button type="button" className="btn ghost" onClick={() => onLogout(true)}>
              {t('settings.logoutForget')}
            </button>
            <p className="muted small">{t('settings.logoutForgetHint')}</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
