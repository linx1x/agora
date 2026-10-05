import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, MicOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { media } from '../media/MediaManager';
import { saveSettings, store, useStore } from '../state/store';
import { LanguageSwitcher } from './common';

export interface JoinChoice {
  mic: boolean;
  cam: boolean;
}

/**
 * Pre-join device check (P3.2). Camera and microphone stay off unless you turn them on
 * here (PRIVACY rule 2); what you see is what you enter with. Nothing is sent to anyone
 * until you join.
 */
export function DeviceCheck({
  spaceName,
  onJoin,
}: {
  spaceName: string;
  onJoin: (c: JoinChoice) => void;
}) {
  const { t } = useTranslation();
  const settings = useStore((s) => s.settings);
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [micId, setMicId] = useState(media.micDeviceId ?? '');
  const [camId, setCamId] = useState(media.camDeviceId ?? '');
  const [speakerId, setSpeakerId] = useState(media.speakerDeviceId ?? '');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const supported = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

  const refreshDevices = () =>
    navigator.mediaDevices
      ?.enumerateDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  useEffect(() => {
    void refreshDevices();
  }, []);

  // Local preview only: one stream for what is switched on, rebuilt when choices change.
  useEffect(() => {
    if (!supported || (!mic && !cam)) {
      setPreview(null);
      return;
    }
    let stop = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({
        audio: mic ? { deviceId: micId ? { exact: micId } : undefined } : false,
        video: cam
          ? {
              deviceId: camId ? { exact: camId } : undefined,
              width: { ideal: 640 },
              height: { ideal: 360 },
            }
          : false,
      })
      .then((s) => {
        if (stop) return s.getTracks().forEach((tr) => tr.stop());
        stream = s;
        setError(null);
        setPreview(s);
        void refreshDevices(); // labels appear once access is granted
      })
      .catch((err: { name?: string }) => {
        if (stop) return;
        const name = err?.name;
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'denied'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'notFound'
              : name === 'NotReadableError'
                ? 'busy'
                : 'unknown',
        );
        if (mic) setMic(false);
        if (cam) setCam(false);
      });
    return () => {
      stop = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [mic, cam, micId, camId, supported]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = preview && cam ? preview : null;
  }, [preview, cam]);

  // Microphone level meter.
  useEffect(() => {
    const track = preview?.getAudioTracks()[0];
    if (!track) {
      setLevel(0);
      return;
    }
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const a = ctx.createAnalyser();
    a.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(a);
    const buf = new Uint8Array(a.fftSize);
    const id = setInterval(() => {
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
    }, 100);
    void ctx.resume();
    return () => {
      clearInterval(id);
      void ctx?.close();
    };
  }, [preview]);

  const testSpeaker = async () => {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const dest = ctx.createMediaStreamDestination();
    const g = ctx.createGain();
    g.connect(dest);
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      const at = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.25, at);
      o.start(at);
      o.stop(at + 0.16);
    });
    const el = new Audio();
    el.srcObject = dest.stream;
    const prev = media.speakerDeviceId;
    media.speakerDeviceId = speakerId || undefined;
    await media.applySink(el);
    media.speakerDeviceId = prev;
    await el.play().catch(() => {});
    setTimeout(() => {
      el.srcObject = null;
      void ctx.close();
    }, 900);
  };

  const join = () => {
    preview?.getTracks().forEach((tr) => tr.stop());
    media.micDeviceId = micId || undefined;
    media.camDeviceId = camId || undefined;
    media.speakerDeviceId = speakerId || undefined;
    media.saveDevices();
    media.unlockAudio();
    onJoin({ mic, cam });
  };

  const list = (k: MediaDeviceKind) => devices.filter((d) => d.kind === k && d.deviceId);
  const picker = (
    kind: MediaDeviceKind,
    label: string,
    value: string,
    set: (v: string) => void,
  ) => {
    const items = list(kind);
    return (
      <label className="field compact">
        <span>{t(label)}</span>
        <select value={value} onChange={(e) => set(e.target.value)} disabled={!items.length}>
          <option value="">{t('settings.default')}</option>
          {items.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${t(label)} ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <main className="login">
      <div className="login-card precheck">
        <div className="login-top">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <h1>{t('precheck.title')}</h1>
          </div>
          <LanguageSwitcher />
        </div>
        <p className="lede">{t('precheck.intro', { name: spaceName || 'Agora' })}</p>
        <div className="precheck-preview" aria-hidden={!cam}>
          {cam && preview ? (
            <video ref={videoRef} autoPlay playsInline muted className="mirrored" />
          ) : (
            <span className="muted small">{t('precheck.camOff')}</span>
          )}
        </div>
        {supported ? (
          <>
            <div className="precheck-toggles">
              <button
                type="button"
                className={`btn ${mic ? 'primary' : 'secondary'}`}
                aria-pressed={mic}
                onClick={() => setMic(!mic)}
              >
                {mic ? <Mic size={16} aria-hidden /> : <MicOff size={16} aria-hidden />}
                <span>{t(mic ? 'precheck.micOn' : 'precheck.micOffBtn')}</span>
              </button>
              <button
                type="button"
                className={`btn ${cam ? 'primary' : 'secondary'}`}
                aria-pressed={cam}
                onClick={() => setCam(!cam)}
              >
                {cam ? <Video size={16} aria-hidden /> : <VideoOff size={16} aria-hidden />}
                <span>{t(cam ? 'precheck.camOn' : 'precheck.camOffBtn')}</span>
              </button>
            </div>
            <div
              className="meter"
              role="meter"
              aria-label={t('precheck.level')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
            >
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <p className="muted small">{t(mic ? 'precheck.speakNow' : 'precheck.micHint')}</p>
            <div className="grid-2">
              {picker('audioinput', 'settings.mic', micId, setMicId)}
              {picker('videoinput', 'settings.cam', camId, setCamId)}
              {'setSinkId' in HTMLMediaElement.prototype &&
                picker('audiooutput', 'settings.speaker', speakerId, setSpeakerId)}
              <div className="field compact">
                <span>{t('precheck.speakerTest')}</span>
                <button type="button" className="btn secondary" onClick={() => void testSpeaker()}>
                  <Volume2 size={16} aria-hidden /> <span>{t('precheck.playSound')}</span>
                </button>
              </div>
            </div>
            {error && (
              <p className="error" role="alert">
                {t(`media.${error}`)}
              </p>
            )}
          </>
        ) : (
          <p className="error" role="alert">
            {t('media.insecure')}
          </p>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={!settings.precheck}
            onChange={(e) => {
              const next = { ...settings, precheck: !e.target.checked };
              saveSettings(next);
              store.set({ settings: next });
            }}
          />
          <span>
            {t('precheck.skip')}
            <span className="muted small"> {t('precheck.skipHint')}</span>
          </span>
        </label>
        <button type="button" className="btn primary" onClick={join}>
          {t('precheck.join')}
        </button>
      </div>
    </main>
  );
}
