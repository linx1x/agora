import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './fr.json';
import en from './en.json';

const saved = (() => {
  try {
    return localStorage.getItem('agora.lang');
  } catch {
    return null;
  }
})();
const browser = navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'fr';

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: saved ?? browser,
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng === 'fr' ? 'fr-CA' : 'en-CA';
  try {
    localStorage.setItem('agora.lang', lng);
  } catch {
    /* private mode */
  }
});
document.documentElement.lang = i18n.language === 'fr' ? 'fr-CA' : 'en-CA';

export default i18n;
