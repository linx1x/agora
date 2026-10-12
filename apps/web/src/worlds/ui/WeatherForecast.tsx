import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { animalsShelter, rainWaters, type WeatherForecast as Forecast } from '@agora/shared';
import { Dialog } from '../../ui/common';

const ICON = { clear: '☀', cloudy: '☁', rain: '☂', thunderstorm: 'ϟ', snow: '❄' } as const;

export function WeatherForecast({ forecast }: { forecast: Forecast }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const today = t(`worlds.weather.kinds.${forecast.today}`);
  const tomorrow = t(`worlds.weather.kinds.${forecast.tomorrow}`);
  return (
    <>
      <button
        type="button"
        className="wh-weather"
        data-weather={forecast.today}
        aria-haspopup="dialog"
        aria-label={t('worlds.weather.summary', { today, tomorrow })}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">{ICON[forecast.today]}</span> {today}
        <span className="wh-weather-next">
          {t('worlds.weather.tomorrow', { weather: tomorrow })}
        </span>
      </button>
      {open &&
        createPortal(
          <Dialog
            title={t('worlds.weather.title')}
            onClose={() => setOpen(false)}
            className="wh-panel"
          >
            <p>{t('worlds.weather.today', { weather: today })}</p>
            <p>{t('worlds.weather.tomorrow', { weather: tomorrow })}</p>
            <p>
              {t(
                rainWaters(forecast.today)
                  ? 'worlds.weather.watering'
                  : 'worlds.weather.manualWater',
              )}
            </p>
            <p>
              {t(
                animalsShelter(forecast.today)
                  ? 'worlds.weather.shelter'
                  : 'worlds.weather.outside',
              )}
            </p>
            <p>{t('worlds.weather.shared')}</p>
          </Dialog>,
          document.body,
        )}
    </>
  );
}
