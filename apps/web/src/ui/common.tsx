import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const next = i18n.language.startsWith('fr') ? 'en' : 'fr';
  return (
    <button
      type="button"
      className="btn ghost lang"
      onClick={() => void i18n.changeLanguage(next)}
      aria-label={t('lang.switchTo')}
      lang={next === 'fr' ? 'fr-CA' : 'en-CA'}
    >
      {next === 'fr' ? 'Français' : 'English'}
    </button>
  );
}

/** Accessible modal dialog: focus trap-lite, Esc closes, focus returns. */
export function Dialog({
  title,
  onClose,
  children,
  wide,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** extra classes, e.g. `sheet` for a bottom sheet on phones */
  className?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not(.dialog-close)',
    );
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = [
          ...ref.current.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], [tabindex="0"]',
          ),
        ].filter((el) => !el.hasAttribute('disabled'));
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          f[f.length - 1]!.focus();
          e.preventDefault();
        } else if (!e.shiftKey && i === f.length - 1) {
          f[0]!.focus();
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className={`dialog-backdrop${className?.includes('sheet') ? ' sheet-backdrop' : ''}`}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2 id="dialog-title">{title}</h2>
          <button
            type="button"
            className="icon-btn dialog-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
