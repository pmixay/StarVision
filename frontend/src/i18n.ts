/**
 * i18n.ts — Multilingual support (Russian / English).
 * Provides translation strings and a language store.
 */

export type Lang = 'ru' | 'en';

export const translations = {
  // Header
  'header.subtitle': {
    ru: 'ЦИФРОВОЙ ДВОЙНИК ГРУППИРОВКИ',
    en: 'CONSTELLATION DIGITAL TWIN',
  },
  'header.utc': { ru: 'UTC', en: 'UTC' },
  'header.spacecraft': { ru: 'КА', en: 'S/C' },
  'header.speed': { ru: 'Скорость', en: 'Speed' },
  'header.isl': { ru: 'МСС', en: 'ISL' },
  'header.status': { ru: 'Статус', en: 'Status' },
  'header.online': { ru: 'ОНЛАЙН', en: 'ONLINE' },
  'header.degraded': { ru: 'СНИЖЕН', en: 'DEGRADED' },
  'header.offline': { ru: 'ОФФЛАЙН', en: 'OFFLINE' },
  'header.checking': { ru: '…', en: '…' },
  'header.source': { ru: 'Источник', en: 'Source' },
  'header.sourceEmbedded': { ru: 'ДЕМО', en: 'DEMO' },
  'header.sourceLive': { ru: 'LIVE', en: 'LIVE' },
  'header.sourceFallback': { ru: 'ДЕМО-ЗАПАСКА', en: 'FALLBACK' },
  'header.sourceMixed': { ru: 'СМЕШАННЫЙ', en: 'MIXED' },
  'header.freshness': { ru: 'Свежесть', en: 'Freshness' },
  'header.freshNow': { ru: 'новые', en: 'fresh' },
  'header.freshAgo': { ru: '{age} назад', en: '{age} ago' },
  'header.stale': { ru: 'УСТАРЕЛО', en: 'STALE' },

  // Control Panel
  'control.title': { ru: 'Управление', en: 'Controls' },
  'control.simSpeed': { ru: 'Скорость симуляции', en: 'Simulation speed' },
  'control.satCount': { ru: 'Количество спутников', en: 'Satellite count' },
  'control.orbitAlt': { ru: 'Высота орбиты', en: 'Orbit altitude' },
  'control.realTLE': { ru: 'реальные TLE', en: 'real TLE' },
  'control.orbitalPlanes': { ru: 'Орбитальные плоскости', en: 'Orbital planes' },
  'control.commRange': { ru: 'Дальность связи', en: 'Communication range' },
  'control.orbitalTracks': { ru: 'Орбитальные треки', en: 'Orbital tracks' },
  'control.satLabels': { ru: 'Подписи спутников', en: 'Satellite labels' },
  'control.islLinks': { ru: 'Линии связи (МСС)', en: 'ISL links' },
  'control.coverageZones': { ru: 'Зоны покрытия', en: 'Coverage zones' },
  'control.constellations': { ru: 'Группировки', en: 'Constellations' },
  'control.reset': { ru: 'Сбросить вид', en: 'Reset view' },
  'control.tleSource': { ru: 'Источник TLE', en: 'TLE source' },
  'control.tleEmbedded': { ru: 'Встроенные', en: 'Embedded' },
  'control.tleCelestrak': { ru: 'CelesTrak', en: 'CelesTrak' },
  'control.tleRefresh': { ru: 'Обновить', en: 'Refresh' },
  'control.tleLoading': { ru: 'Загрузка...', en: 'Loading...' },
  'control.tleError': {
    ru: 'Не удалось загрузить TLE: {error}',
    en: 'Could not load TLE: {error}',
  },
  'control.tleFallbackWarn': {
    ru: 'CelesTrak недоступен — показываю встроенные TLE',
    en: 'CelesTrak unavailable — showing embedded TLE',
  },
  'control.tleFallbackDetail': {
    ru: 'CelesTrak недоступен; показаны встроенные TLE. Перепроверьте сеть.',
    en: 'CelesTrak unavailable; showing embedded TLE. Check your network.',
  },
  'control.tleAgeSec': { ru: '{sec} сек назад', en: '{sec} sec ago' },
  'control.tleAgeMin': { ru: '{min} мин назад', en: '{min} min ago' },
  'control.tleNeverFetched': { ru: 'нет запроса к CelesTrak', en: 'no CelesTrak fetch yet' },
  // Opaque error codes emitted by the backend (no stack-trace leakage)
  'error.upstream_timeout': { ru: 'таймаут CelesTrak', en: 'CelesTrak timeout' },
  'error.upstream_network_error': { ru: 'сетевая ошибка', en: 'network error' },
  'error.upstream_unavailable': { ru: 'CelesTrak недоступен', en: 'CelesTrak unavailable' },
  'error.upstream_empty_response': { ru: 'пустой ответ CelesTrak', en: 'empty CelesTrak response' },
  'control.circularOrbits': { ru: 'Круговые орбиты', en: 'Circular orbits' },
  'control.scPerPlane': { ru: 'КА/плоскость', en: 'S/C per plane' },
  'control.plane_one': { ru: 'плоскость', en: 'plane' },
  'control.plane_few': { ru: 'плоскости', en: 'planes' },
  'control.plane_many': { ru: 'плоскостей', en: 'planes' },

  // Satellite Info Panel
  'info.active': { ru: 'Активен', en: 'Active' },
  'info.inactive': { ru: 'Неактивен', en: 'Inactive' },
  'info.archived': { ru: 'Архивный', en: 'Archived' },
  'info.deorbited': { ru: 'Сведён с орбиты', en: 'Deorbited' },
  'info.archiveDate': { ru: 'Дата снятия', en: 'Archive date' },
  'info.archivalNoTelemetry': {
    ru: 'Телеметрия недоступна: спутник снят с орбиты.',
    en: 'Telemetry unavailable: spacecraft is archival.',
  },
  'info.telemetry': { ru: 'Телеметрия', en: 'Telemetry' },
  'info.altitude': { ru: 'Высота', en: 'Altitude' },
  'info.velocity': { ru: 'Скорость', en: 'Velocity' },
  'info.period': { ru: 'Период', en: 'Period' },
  'info.latitude': { ru: 'Широта', en: 'Latitude' },
  'info.longitude': { ru: 'Долгота', en: 'Longitude' },
  'info.eciCoords': { ru: 'ECI координаты (км)', en: 'ECI coordinates (km)' },
  'info.metadata': { ru: 'Информация', en: 'Information' },
  'info.noradId': { ru: 'NORAD ID', en: 'NORAD ID' },
  'info.constellation': { ru: 'Группировка', en: 'Constellation' },
  'info.purpose': { ru: 'Назначение', en: 'Purpose' },
  'info.launch': { ru: 'Запуск', en: 'Launch' },
  'info.focusCamera': { ru: 'Навести камеру', en: 'Focus camera' },

  // StarAI Chat
  'chat.analyzing': { ru: 'Анализирую...', en: 'Analyzing...' },
  'chat.ready': { ru: 'Готов помочь', en: 'Ready to help' },
  'chat.intro': {
    ru: 'Я StarAI — интеллектуальный ассистент StarVision.',
    en: 'I am StarAI — StarVision intelligent assistant.',
  },
  'chat.introSub': {
    ru: 'Спроси о спутниках или управляй визуализацией.',
    en: 'Ask about satellites or control the visualization.',
  },
  'chat.placeholder': { ru: 'Спроси StarAI...', en: 'Ask StarAI...' },
  'chat.open': { ru: 'Открыть чат StarAI', en: 'Open StarAI chat' },
  'chat.close': { ru: 'Закрыть чат', en: 'Close chat' },
  'chat.send': { ru: 'Отправить сообщение', en: 'Send message' },
  'chat.error': {
    ru: 'Ошибка связи с сервером. Попробуйте позже.',
    en: 'Server connection error. Please try again later.',
  },
  'chat.invalidAction': {
    ru: 'Отклонено действие: {reason}',
    en: 'Rejected action: {reason}',
  },
  'chat.actionDone_one': { ru: 'действие выполнено', en: 'action executed' },
  'chat.actionDone_many': { ru: 'действий выполнено', en: 'actions executed' },
  'chat.hint1': { ru: 'Расскажи про УмКА-1', en: 'Tell me about UmKA-1' },
  'chat.hint2': { ru: 'Покажи Декарт', en: 'Show Dekart' },
  'chat.hint3': { ru: 'Ускорь время в 50 раз', en: 'Speed up time 50x' },
  'chat.hint4': { ru: 'Сколько активных связей?', en: 'How many active links?' },
  'chat.hint5': { ru: 'Покажи все орбиты', en: 'Show all orbits' },
  'chat.hint6': { ru: 'Установи 10 спутников', en: 'Set 10 satellites' },
  // ISL tooltip
  'isl.distance': { ru: 'км', en: 'km' },

  // Header status
  'header.fresh': { ru: 'Свежесть', en: 'Freshness' },
  'header.sourceCelestrak': { ru: 'CELESTRAK', en: 'CELESTRAK' },
  'header.sourcePartial': { ru: 'ЧАСТ. LIVE', en: 'PARTIAL' },
  'header.freshJustNow': { ru: 'только что', en: 'just now' },
  'header.freshMinutes': { ru: 'мин назад', en: 'min ago' },
  'header.freshHours': { ru: 'ч назад', en: 'h ago' },

  // Events / toasts
  'events.title': { ru: 'Журнал', en: 'Event log' },
  'events.empty': { ru: 'Событий пока нет', en: 'No events yet' },
  'events.clear': { ru: 'Очистить', en: 'Clear' },
  'event.tleLoaded': { ru: 'TLE загружены', en: 'TLE loaded' },
  'event.tleFallback': {
    ru: 'CelesTrak недоступен — используется встроенный каталог',
    en: 'CelesTrak unavailable — using embedded catalog',
  },
  'event.tlePartial': {
    ru: 'CelesTrak частично недоступен — часть КА используют встроенные TLE',
    en: 'CelesTrak partial — some S/C use embedded TLE',
  },
  'event.tleRefreshed': { ru: 'Кэш TLE обновлён', en: 'TLE cache refreshed' },
  'event.starAIError': { ru: 'Ошибка StarAI', en: 'StarAI error' },
  'event.apiError': { ru: 'Ошибка API', en: 'API error' },
  'event.healthDegraded': { ru: 'Бэкенд недоступен', en: 'Backend unreachable' },
  'event.healthRestored': { ru: 'Бэкенд восстановлен', en: 'Backend restored' },
  'event.collisionForecast': { ru: 'Прогноз сближений', en: 'Collision forecast' },
  'event.optimizerApply': { ru: 'Применена конфигурация Walker', en: 'Walker config applied' },

  // Mode indicator
  'mode.realTle': { ru: 'Реальные TLE', en: 'Real TLE' },
  'mode.virtual': { ru: 'Виртуальная орбита', en: 'Virtual orbit' },

  // Collision / optimizer / dashboard
  'dashboard.title': { ru: 'Mission Dashboard', en: 'Mission Dashboard' },
  'dashboard.operational': { ru: 'Активные', en: 'Operational' },
  'dashboard.archival': { ru: 'Архивные', en: 'Archival' },
  'dashboard.visible': { ru: 'Видимые', en: 'Visible' },
  'dashboard.activeIsl': { ru: 'Активные МСС', en: 'Active ISL' },
  'dashboard.commRange': { ru: 'Дальность', en: 'Comm range' },
  'dashboard.mode': { ru: 'Режим', en: 'Mode' },
  'dashboard.source': { ru: 'Источник', en: 'Source' },
  'dashboard.collisions': { ru: 'Сближения', en: 'Close approaches' },
  'collision.title': { ru: 'Прогноз сближений', en: 'Collision forecast' },
  'collision.threshold': { ru: 'Порог (км)', en: 'Threshold (km)' },
  'collision.horizon': { ru: 'Горизонт (ч)', en: 'Horizon (h)' },
  'collision.run': { ru: 'Рассчитать', en: 'Run forecast' },
  'collision.running': { ru: 'Считаю...', en: 'Computing...' },
  'collision.none': { ru: 'Опасных сближений не найдено', en: 'No risky approaches found' },
  'collision.minDist': { ru: 'Мин. расст.', en: 'Min dist' },
  'collision.tca': { ru: 'Время', en: 'Time' },
  'optimizer.title': { ru: 'Оптимизатор Walker', en: 'Walker optimizer' },
  'optimizer.run': { ru: 'Рассчитать', en: 'Compute' },
  'optimizer.apply': { ru: 'Применить к виртуальному режиму', en: 'Apply to virtual mode' },
  'optimizer.altitude': { ru: 'Высота (км)', en: 'Altitude (km)' },
  'optimizer.inclination': { ru: 'Наклонение (°)', en: 'Inclination (°)' },
  'optimizer.planes': { ru: 'Плоскости', en: 'Planes' },
  'optimizer.sats': { ru: 'Спутники', en: 'Satellites' },
  'optimizer.period': { ru: 'Период', en: 'Period' },
  'optimizer.velocity': { ru: 'Скорость', en: 'Velocity' },

  // Constellation names
  'constellation.universat': { ru: 'УниверСат', en: 'UniverSat' },
  'constellation.bauman': { ru: 'МГТУ Баумана', en: 'Bauman MSTU' },
  'constellation.sputnix': { ru: 'SPUTNIX', en: 'SPUTNIX' },
  'constellation.geoscan': { ru: 'Геоскан', en: 'Geoscan' },
  'constellation.sinp': { ru: 'НИИЯФ МГУ', en: 'SINP MSU' },
  'constellation.spacepi': { ru: 'Space-Pi', en: 'Space-Pi' },
} as const;

export type TranslationKey = keyof typeof translations;

// Constellation key mapping (internal Russian name -> i18n key)
export const CONSTELLATION_KEYS: Record<string, string> = {
  'УниверСат': 'constellation.universat',
  'МГТУ Баумана': 'constellation.bauman',
  'SPUTNIX': 'constellation.sputnix',
  'Геоскан': 'constellation.geoscan',
  'НИИЯФ МГУ': 'constellation.sinp',
  'Space-Pi': 'constellation.spacepi',
};

// Reverse mapping: get internal name from localized display name
export function getInternalConstellationName(displayName: string, lang: Lang): string {
  for (const [internal, key] of Object.entries(CONSTELLATION_KEYS)) {
    const tKey = key as TranslationKey;
    if (translations[tKey][lang] === displayName) return internal;
  }
  return displayName;
}

export function t(key: TranslationKey, lang: Lang, vars?: Record<string, string | number>): string {
  const raw = translations[key]?.[lang] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

// Translate constellation internal name to display name
export function tConstellation(internalName: string, lang: Lang): string {
  const key = CONSTELLATION_KEYS[internalName] as TranslationKey | undefined;
  if (key && translations[key]) return translations[key][lang];
  return internalName;
}
