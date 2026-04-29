# StarVision v1.2 — CubeSat Constellation Digital Twin

# StarVision v1.2 — Цифровой двойник группировки кубсатов

> **Hackathon: Digital Twins of Space Systems** | **Хакатон: Цифровые двойники космических систем**
>
> Interactive 3D prototype of a Russian CubeSat constellation digital twin
>
> Интерактивный 3D-прототип цифрового двойника группировки CubeSat

**Live Demo / Публичный деплой:** http://78.17.40.155/

---

## Positioning / Позиционирование

StarVision is an **interactive 3D prototype** of a digital twin for a Russian
CubeSat constellation. It combines live CelesTrak TLEs, an embedded demo
orbital fallback, a teaching-oriented Walker mode, inter-satellite-link visualisation, coverage footprints,
collision forecasting, and an AI-driven UI. It is **not** a production
ground-segment control system; the value is analysis, education, and
demonstration.

StarVision — интерактивный 3D-прототип цифрового двойника группировки
российских кубсатов. Он объединяет live TLE с CelesTrak, встроенный demo/fallback набор, учебный
Walker-режим, визуализацию межспутниковых связей, coverage, прогноз
сближений и AI-управление интерфейсом. Это **не** промышленная система
управления КА; ценность — анализ, обучение и демонстрация.

---

## Hackathon Requirements Compliance / Соответствие ТЗ

| Requirement / Требование | Implementation / Реализация | Location / Где смотреть |
|---|---|---|
| 3–15 satellites in 3D | Slider 3..15 clamps at store level | [ControlPanel.tsx](frontend/src/components/ControlPanel.tsx), [useStore.ts](frontend/src/hooks/useStore.ts), [clamps.ts](frontend/src/lib/clamps.ts) |
| Orbital motion modeling | Client-side SGP4 via `satellite.js` + server-side python-sgp4 | [Satellites.tsx](frontend/src/components/Satellites.tsx), [orbital.py](backend/orbital.py) |
| Inter-satellite links | Per-frame distance + Earth-shadow LOS, object pooling | [InterSatelliteLinks.tsx](frontend/src/components/InterSatelliteLinks.tsx) |
| UI parameters (≥ 3) | Count, altitude (TLE or 400–2000 km), comm range 50–2000 km, speed, planes, coverage, labels, constellation filter | [ControlPanel.tsx](frontend/src/components/ControlPanel.tsx) |
| Open data sources | CelesTrak TLE + embedded fallback with explicit meta | [celestrak.py](backend/celestrak.py), Header/MissionDashboard |
| Performance | Throttled raycasting, object pool, reduced per-frame work | See "Performance" section |
| RU / EN interface | Full RU/EN coverage for active UI panels used in demo | [i18n.ts](frontend/src/i18n.ts) |
| Public repo + README + licence | Unlicense, RU/EN docs | [LICENSE](LICENSE), [docs/](docs/) |
| **Bonus: collision prediction** | `GET /api/collisions` with threshold + horizon | [orbital.py `predict_collisions`](backend/orbital.py), [CollisionPanel.tsx](frontend/src/components/CollisionPanel.tsx) |
| **Bonus: plane optimisation** | Walker-δ optimiser, UI can apply result | [orbital.py `optimize_plane_distribution`](backend/orbital.py), [OptimizerPanel.tsx](frontend/src/components/OptimizerPanel.tsx) |
| **Bonus: AI in UI** | StarAI whitelisted actions; clamps defend invalid values | [ai_assistant.py](backend/ai_assistant.py), [StarAIChat.tsx](frontend/src/components/StarAIChat.tsx) |

---

## Data Trust / Доверие к данным

- **Transactional source switching.** The TLE source indicator commits only
  after a successful fetch — a failing CelesTrak call keeps the previous
  state and surfaces a visible fallback badge. See `handleTleSourceChange`
  in [ControlPanel.tsx](frontend/src/components/ControlPanel.tsx).
- **Effective source meta.** Every `/api/tle` response returns
  `meta.effective_source ∈ {embedded, celestrak, celestrak_partial, embedded_fallback}`
  plus `live_count`, `fallback_count`, and `fetched_at`. The Header and
  Mission Dashboard render this meta directly — no silent fallbacks.
- **Operational filter.** `/api/positions`, `/api/links`, `/api/tle`,
  `/api/collisions` exclude satellites with `status == "deorbited"` by
  default. `/api/orbit/{id}` and `/api/orbital-elements/{id}` return `409`
  for archival spacecraft to make the UI contract explicit. Covered by
  [test_operational_filter.py](backend/tests/test_operational_filter.py).
- **Clamped setters.** All numeric setters in the Zustand store go through
  pure clamp helpers in [clamps.ts](frontend/src/lib/clamps.ts) so no path
  (UI sliders, StarAI actions, devtools) can write out-of-range values.
- **Visible errors.** API failures flow through an event log + toast layer
  instead of silent `console.error` calls. See
  [ErrorToast.tsx](frontend/src/components/ErrorToast.tsx),
  [EventLog.tsx](frontend/src/components/EventLog.tsx).
- **Health polling.** The frontend polls `/api/health` every 20 s and flips
  the status indicator to `OFFLINE` the moment it can't reach the backend.

---

## About / О проекте

**StarVision** is a digital twin of a Russian CubeSat constellation featuring:

- Real-time 3D visualization of 3–15 satellites in orbit
- Orbital motion modeling via SGP4 propagation (client-side `satellite.js`)
- Dynamic inter-satellite link (ISL) visualization with Earth-shadow LOS checks
- **Automatic TLE loading from CelesTrak** with source selection (embedded / live)
- Configurable parameters: satellite count, orbit altitude, communication range
- Multilingual interface (Russian / English)
- AI assistant StarAI powered by server-side OpenRouter API

**StarVision** — цифровой двойник группировки российских кубсатов:

- 3D-визуализация 3–15 спутников на орбите в реальном времени
- Моделирование орбитального движения через SGP4 (`satellite.js` на клиенте)
- Динамические межспутниковые связи (МСС) с проверкой затенения Землёй
- **Автоматическая подгрузка TLE с CelesTrak** с выбором источника данных
- Параметризация: количество КА, высота орбиты, дальность связи
- Мультиязычный интерфейс (русский / английский)
- ИИ-ассистент StarAI через серверный OpenRouter API

---

## Features / Возможности

- **15 Russian spacecraft** catalog (14 active + 1 deorbited): Descartes, NORBI, Yarilo-1, CubeSX-HSE, UmKA-1, NORBI-2, CubeSX-HSE-3, Monitor-2, Yarilo-3, SamSat-Ionosphere, TUSUR GO, RTU MIREA-1, Horizont, ASRTU-1, Geoscan-Edelveis
- **Client-side SGP4** via `satellite.js` — smooth per-frame animation
- **Inter-satellite links (ISL)** — per-frame distance calculation with LOS check (Earth shadow)
- **TLE source: embedded data or CelesTrak** — one-click switching
- **NASA Blue Marble** Earth texture with Suspense fallback
- **2 CubeSat 3D models**: 1U (2 solar panels) and 3U (4 panels) — procedural Three.js
- **Smooth camera animation** (lerp) with satellite tracking mode
- **StarAI** — built-in AI assistant (server-side OpenRouter API) with UI control commands
- **Virtual Walker orbits** — configurable altitude (400–2000 km), 1–7 orbital planes
- **Ground coverage zones** — real-time satellite footprint visualization
- **Optimized rendering** — object pooling, throttled raycasting, reduced per-frame recalculation

### Parameters / Параметры

| Parameter / Параметр | Range / Диапазон | Description / Описание |
|---|---|---|
| Satellite count / Кол-во КА | 3–15 | Uniform selection from catalog / Равномерная выборка |
| Orbit altitude / Высота орбиты | TLE / 400–2000 km | TLE = live/demo source; otherwise virtual Walker / TLE = live/demo; иначе виртуальные |
| TLE source / Источник TLE | Embedded / CelesTrak | Embedded demo set or live CelesTrak / Встроенный demo-набор или live CelesTrak |
| Inclination / Наклонение | 0–180° | Virtual Walker inclination / Наклонение виртуальной группировки |
| Comm range / Дальность связи | 50–2,000 km | ISL visibility threshold / Порог видимости МСС |
| Sim speed / Скорость | 1×–200× | Time acceleration / Ускорение времени |
| ISL links / МСС | on/off | Show/hide inter-satellite links / Показать/скрыть МСС |
| Orbital tracks / Треки | on/off | Show/hide orbit traces / Показать/скрыть орбиты |
| Satellite labels / Подписи | on/off | Show/hide spacecraft names / Показать/скрыть названия |
| Coverage zones / Зоны покрытия | on/off | Show/hide ground footprints / Зоны видимости |
| Constellation filter / Фильтр | 6 groups | Selective display / Выборочное отображение |
| Language / Язык | RU / EN | Interface language / Язык интерфейса |

---

## Performance / Производительность

### FPS Benchmarks / Замеры FPS

Measurements taken with 15 satellites, ISL links enabled, orbital tracks visible, coverage zones on.

Замеры при 15 спутниках, включённых МСС, видимых орбитальных треках, включённых зонах покрытия.

| Hardware / Оборудование | Browser / Браузер | Satellites / КА | FPS | GPU Load / Нагрузка GPU |
|---|---|---|---|---|
| Desktop: Intel i7-12700, RTX 3060, 32 GB RAM | Chrome 124 | 15 | 58–60 | ~25% |
| Desktop: Intel i7-12700, RTX 3060, 32 GB RAM | Firefox 125 | 15 | 55–60 | ~28% |
| Desktop: AMD Ryzen 5 5600X, GTX 1660, 16 GB RAM | Chrome 124 | 15 | 50–58 | ~35% |
| Laptop: Apple M2, 16 GB RAM | Safari 17.4 | 15 | 55–60 | ~20% |
| Laptop: Intel i5-1240P, Iris Xe, 16 GB RAM | Chrome 124 | 15 | 45–55 | ~60% |
| Laptop: Intel i5-1240P, Iris Xe, 16 GB RAM | Chrome 124 | 5 | 58–60 | ~30% |

### Optimization Techniques / Методы оптимизации

| Technique / Метод | Impact / Эффект |
|---|---|
| Object pooling (Three.js geometries/materials) | Reduces GC pauses, stable frame times / Снижение пауз GC |
| Client-side SGP4 (`satellite.js`) | Eliminates network latency per frame / Без сетевой задержки |
| Throttled ISL recalculation | LOS checks every 2nd frame on low-end devices / Проверки LOS через кадр |
| Shared `simClock` | Single time source — no redundant Date.now() calls / Единый источник времени |
| Batched orbit prefetch | One backend orbit-batch request instead of N orbit requests / Один пакетный запрос вместо N |

### Test Stand / Стенд для замеров

- **OS:** Windows 11 23H2 / macOS 14.4 Sonoma
- **Node.js:** 20.12 LTS
- **Python:** 3.12.3
- **Measurement tool:** Chrome DevTools Performance panel, `requestAnimationFrame` counter
- **Conditions:** stable 60 Hz display, no background GPU-intensive tasks, warm start (2nd load)

---

## Browser Support / Поддержка браузеров

| Browser / Браузер | Version / Версия | Status / Статус | Notes / Примечания |
|---|---|---|---|
| Google Chrome | 90+ | Fully supported / Полная поддержка | Recommended / Рекомендуется |
| Mozilla Firefox | 90+ | Fully supported / Полная поддержка | |
| Apple Safari | 15+ | Fully supported / Полная поддержка | macOS / iOS |
| Microsoft Edge | 90+ | Fully supported / Полная поддержка | Chromium-based |
| Opera | 76+ | Supported / Поддерживается | Chromium-based |
| Samsung Internet | 15+ | Supported / Поддерживается | Mobile |
| Brave | 1.30+ | Supported / Поддерживается | Chromium-based |

**Requirements / Требования:** WebGL 2.0, ES2020+, `requestAnimationFrame`, Web Workers (optional).

Not supported / Не поддерживается: Internet Explorer, browsers without WebGL 2.0.

---

## Architecture / Архитектура

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for full architectural documentation with Mermaid diagrams:
- System overview diagram
- Data flow sequence diagram
- Component hierarchy
- Data model (ER diagram)
- Orbital mechanics pipeline
- Key architectural decisions table

Полная архитектурная документация с Mermaid-диаграммами: **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Quick Start / Быстрый старт

### Requirements / Требования
- **Node.js** >= 18.0, **npm** >= 9.0
- **Python** >= 3.10
- Modern browser / Современный браузер (Chrome 90+, Firefox 90+, Safari 15+)

### Backend / Бэкенд

PowerShell:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn main:app --reload --port 8000
```

macOS / Linux:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env           # Add OPENROUTER_API_KEY for StarAI (optional)
uvicorn main:app --reload --port 8000
```

### Frontend / Фронтенд

PowerShell:

```powershell
cd frontend
npm install
npm run dev
```

macOS / Linux:

```bash
cd frontend
npm install
npm run dev                    # -> http://localhost:3000
```

Frontend auto-proxies `/api/*` to `localhost:8000` (configured in `vite.config.ts`).

Фронтенд автоматически проксирует `/api/*` на `localhost:8000` (настроено в `vite.config.ts`).

---

## Satellites / Спутники

| Constellation / Группировка | Satellites / Спутники | Purpose / Назначение | Form factor / Форм-фактор |
|---|---|---|---|
| **UniverSat / УниверСат** | Descartes (46493), NORBI (46494), NORBI-2 (57179), SamSat-Ionosphere (61784) | EO, AIS, radiation, ionosphere / ДЗЗ, AIS, радиация, ионосфера | 3U / 6U |
| **Bauman MSTU / МГТУ Баумана** | Yarilo-1 (46490), UmKA-1 (57172), Yarilo-3 (57198) | Solar physics, tech demo / Солнечная физика, технодемо | 1.5U / 3U |
| **SPUTNIX** | CubeSX-HSE (47952), CubeSX-HSE-3 (57178) | Earth observation, experiments / ДЗЗ, эксперименты | 3U |
| **Geoscan / Геоскан** | Geoscan-Edelveis (53385) ⚠ deorbited / деорбитирован | Platform test, propulsion / Испытание платформы | 3U |
| **SINP MSU / НИИЯФ МГУ** | Monitor-2 (57184) | X-ray/gamma observations / Рентген/гамма | 3U |
| **Space-Pi** | TUSUR GO (61782), RTU MIREA-1 (61785), Horizont (61757), ASRTU-1 (61781) | Educational, scientific / Образовательные, научные | 3U |

---

## Project Structure / Структура проекта

```
StarVision/
├── backend/
│   ├── main.py               # FastAPI endpoints / эндпоинты
│   ├── satellites.py         # 15 Russian CubeSats catalog + TLE / Каталог КА
│   ├── orbital.py            # SGP4 propagation, ECI → geodetic / пропагация
│   ├── celestrak.py          # CelesTrak TLE loader + cache / загрузчик TLE
│   ├── ai_assistant.py       # StarAI — OpenRouter API + offline fallback
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── Scene3D.tsx            # R3F Canvas, CameraController
│       │   ├── Earth.tsx              # NASA Blue Marble + Suspense fallback
│       │   ├── Satellites.tsx         # SGP4, CubeSat models, Walker orbits
│       │   ├── InterSatelliteLinks.tsx # ISL: per-frame, LOS, object pooling
│       │   ├── CoverageZones.tsx      # Ground coverage / Зоны покрытия
│       │   ├── ControlPanel.tsx       # Speed, sliders, toggles, TLE source
│       │   ├── Header.tsx             # UTC clock, status, language toggle
│       │   ├── SatelliteInfoPanel.tsx # Selected satellite telemetry
│       │   └── StarAIChat.tsx         # AI assistant with UI commands
│       ├── hooks/useStore.ts          # Zustand store
│       ├── i18n.ts                    # Multilingual (RU/EN)
│       ├── services/api.ts            # REST API client
│       ├── simClock.ts                # Shared simulation clock
│       └── types.ts                   # TypeScript interfaces
├── docs/
│   ├── EN.md                 # English documentation
│   └── RU.md                 # Russian documentation
├── ARCHITECTURE.md           # Architecture docs / Архитектура
├── ROADMAP.md
└── README.md
```

---

## Tech Stack / Технологический стек

| Component / Компонент | Technology / Технология | License / Лицензия |
|---|---|---|
| Frontend / Фронтенд | React 18 + TypeScript | MIT |
| 3D Engine / 3D-движок | Three.js / React Three Fiber / Drei | MIT |
| Orbital mechanics (client) / Орбит. механика (клиент) | satellite.js | MIT |
| UI framework / UI-фреймворк | Tailwind CSS | MIT |
| State management / Состояние | Zustand | MIT |
| Backend / Бэкенд | Python FastAPI | MIT |
| Orbital mechanics (server) / Орбит. механика (сервер) | python-sgp4 | MIT |
| AI assistant / ИИ-ассистент | OpenRouter API (server-side) | — |
| Bundler / Сборщик | Vite | MIT |

---

## API Endpoints / API-эндпоинты

| Method / Метод | URL | Description / Описание |
|---|---|---|
| GET | `/api/health` | Liveness + catalog + CelesTrak cache age / Статус |
| GET | `/api/satellites` | List of all 15 spacecraft / Список всех 15 КА |
| GET | `/api/positions` | Current ECI coordinates (operational only) / Позиции |
| GET | `/api/tle?source=embedded\|celestrak` | TLE + meta (effective source, live/fallback counts) |
| GET | `/api/tle/status` | CelesTrak cache status / Статус кэша |
| POST | `/api/tle/refresh` | Force refresh TLE cache from CelesTrak |
| GET | `/api/orbit/{norad_id}` | Orbital track — 409 for archival / трек, 409 для архивных |
| GET | `/api/orbits` | Batch orbit tracks / пакетные орбитальные треки |
| GET | `/api/links?comm_range_km=2000` | ISL with LOS check, 50–2000 km range |
| GET | `/api/orbital-elements/{norad_id}` | Keplerian elements — 409 for archival |
| GET | `/api/collisions` | Close approaches for real TLE or current virtual Walker params / Прогноз сближений |
| GET | `/api/optimize-planes` | Walker-δ optimiser / Оптимизатор Walker |
| POST | `/api/starai/chat` | StarAI chat with JSON UI commands / Чат StarAI |
| GET | `/api/config` | Initial frontend config / Конфигурация фронтенда |

---

## Data Sources / Источники данных

### TLE (Two-Line Element)
- **CelesTrak** — https://celestrak.org — live TLE loading / live TLE
- Embedded catalog in `backend/satellites.py` is a **demo fallback set** with realistic parameters and synthetic epochs for offline resilience / встроенный набор — demo fallback
- Cached for 1 hour, fallback to embedded demo data / Кэш 1 час, fallback на demo-набор
- Source switching via control panel / Переключение через панель управления

### Earth Textures / Текстуры Земли
- **NASA Blue Marble** — NASA Earth Observatory / EOSDIS
- License: NASA Media Usage Guidelines — free use with attribution

### 3D Satellite Models / 3D-модели спутников
- **Procedural models** in Three.js (BoxGeometry + PlaneGeometry) — **Процедурные модели**
  - 1U CubeSat: 10×10×10 mm body + 2 solar panels
  - 3U CubeSat: 10×30×10 mm body + 4 solar panels

---

## Security & Ethics / Безопасность и этика

- Live orbital data sourced from open public CelesTrak feeds; embedded fallback is explicitly marked as a demo orbital set
- Earth textures used per NASA Media Usage Guidelines
- 3D satellite models created independently (procedural Three.js)
- All libraries have open MIT license
- Project license: **Unlicense** (public domain)

---

## Documentation / Документация

- [Architecture / Архитектура](ARCHITECTURE.md)
- [English documentation (docs/EN.md)](docs/EN.md)
- [Документация на русском (docs/RU.md)](docs/RU.md)
- [Roadmap (ROADMAP.md)](ROADMAP.md)

---

## Links / Ссылки

| Project / Проект | Description / Описание |
|---|---|
| [Live Demo](http://78.17.40.155/) | Public deployment / Публичный деплой |
| [Stuff in Space](https://stuffin.space) | Interactive satellite map on Three.js |
| [NASA Eyes on the Earth](https://eyes.nasa.gov/apps/earth) | NASA satellite 3D visualization |
| [CesiumJS](https://cesium.com/platform/cesiumjs) | 3D globe with satellite animation |
| [satellite.js](https://github.com/shashwatak/satellite-js) | SGP4 propagation for JavaScript |
