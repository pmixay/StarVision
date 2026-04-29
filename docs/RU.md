# StarVision v1.2 — Цифровой двойник группировки кубсатов

> **Хакатон: Цифровые двойники космических систем**
> Интерактивный 3D-прототип цифрового двойника группировки CubeSat

---

## О проекте

**StarVision** — цифровой двойник группировки российских кубсатов:
- 3D-визуализация 3–15 спутников на орбите в реальном времени
- Моделирование орбитального движения через SGP4 (`satellite.js` на клиенте)
- Динамические межспутниковые связи (МСС) с проверкой затенения Землёй
- **Автоматическая подгрузка TLE с CelesTrak** с выбором источника данных
- Параметризация: количество КА, высота орбиты, дальность связи
- Мультиязычный интерфейс (русский / английский)
- ИИ-ассистент StarAI через серверный OpenRouter API

---

## Возможности

- **15 российских КА** в каталоге (14 активных + 1 деорбитированный): Декарт, НОРБИ, Ярило-1, CubeSX-HSE, УмКА-1, НОРБИ-2, CubeSX-HSE-3, Монитор-2, Ярило-3, СамСат-Ионосфера, TUSUR GO, RTU MIREA-1, Горизонт, ASRTU-1, Геоскан-Эдельвейс
- **Клиентская SGP4** через `satellite.js` — плавная покадровая анимация
- **Межспутниковые связи (МСС)** — расчёт расстояний и LOS-проверка (затенение Землёй)
- **Источник TLE: встроенные данные или CelesTrak** — переключение в один клик
- **NASA Blue Marble** текстура Земли с Suspense fallback
- **2 модели CubeSat**: 1U (2 панели) и 3U (4 панели) — процедурные Three.js
- **Плавная анимация камеры** (lerp) с режимом слежения за спутником
- **StarAI** — встроенный ИИ-ассистент (серверный OpenRouter API) с командами управления
- **Виртуальные Walker-орбиты** — настраиваемая высота (400–2000 км), 1–7 плоскостей
- **Зоны покрытия** — визуализация зоны видимости спутников на поверхности Земли
- **Оптимизированный рендеринг** — пулинг объектов, дросселирование, адаптивный DPR

### Параметры (по ТЗ 3.5)

| Параметр | Диапазон | Описание |
|---|---|---|
| Количество КА | 3–15 | Равномерная выборка из каталога |
| Высота орбиты | TLE / 400–2000 км | TLE = реальные данные; иначе виртуальные Walker-орбиты |
| Источник TLE | Встроенные / CelesTrak | Выбор между демо-данными и актуальными с CelesTrak |
| Дальность связи | 50–2 000 км | Порог видимости МСС |
| Скорость симуляции | 1×–200× | Пресеты ускорения времени |
| МСС линии | вкл/выкл | Показать/скрыть межспутниковые связи |
| Орбитальные треки | вкл/выкл | Показать/скрыть орбиты |
| Подписи КА | вкл/выкл | Показать/скрыть названия спутников |
| Зоны покрытия | вкл/выкл | Визуализация зон видимости спутников на поверхности Земли |
| Фильтр группировок | 6 групп | Выборочное отображение по группировке |
| Язык | RU / EN | Язык интерфейса |

---

## Архитектура

### Общая схема системы

```mermaid
graph TB
    subgraph Frontend["Frontend (React + Three.js)"]
        UI[UI Panels]
        Scene[3D Scene]
        Store[Zustand Store]
        SGP4c[satellite.js SGP4]
        API_Client[API Client]

        UI -->|setState| Store
        Store -->|useStore| Scene
        Store -->|useStore| UI
        Scene -->|useFrame| SGP4c
        API_Client -->|fetch| Store
    end

    subgraph Backend["Backend (FastAPI + Python)"]
        REST[REST API]
        Orbital[orbital.py - SGP4]
        Catalog[satellites.py - Каталог]
        AI[ai_assistant.py - StarAI]
        Celestrak[celestrak.py - TLE загрузчик]

        REST --> Orbital
        REST --> Catalog
        REST --> AI
        REST --> Celestrak
        Orbital --> Catalog
        Celestrak --> Catalog
    end

    subgraph External["Внешние сервисы"]
        OpenRouter[OpenRouter API]
        TLE_src[CelesTrak]
        NASA[NASA Blue Marble]
    end

    API_Client -->|HTTP/JSON| REST
    AI -->|API call| OpenRouter
    Celestrak -->|TLE данные| TLE_src
    Scene -.->|текстура| NASA

    style Frontend fill:#0d1b2a,stroke:#3389ff,color:#d9ecff
    style Backend fill:#1b2838,stroke:#33ffaa,color:#d9ecff
    style External fill:#2a1b38,stroke:#aa33ff,color:#d9ecff
```

### Потоки данных

```mermaid
sequenceDiagram
    participant User
    participant UI as UI (React)
    participant Store as Zustand Store
    participant Scene as 3D Scene
    participant API as FastAPI
    participant SGP4 as SGP4 Engine
    participant CT as CelesTrak

    User->>UI: Взаимодействие (клик, ползунок)
    UI->>Store: setState()
    Store->>Scene: Re-render

    Note over Scene: useFrame() — каждый кадр
    Scene->>SGP4: propagate(satrec, date)
    SGP4-->>Scene: ECI позиция (x, y, z)

    Note over UI,API: Выбор источника TLE
    UI->>API: GET /api/tle?source=celestrak
    API->>CT: HTTP запрос TLE
    CT-->>API: TLE данные
    API-->>Store: JSON response
```

### Архитектура компонентов

```mermaid
graph LR
    subgraph App["App.tsx"]
        Header
        ControlPanel
        InfoPanel[SatelliteInfoPanel]
        Chat[StarAIChat]
        Scene3D
    end

    subgraph Scene3D_inner["Scene3D"]
        Camera[CameraController]
        Earth
        Sats[Satellites]
        ISL[InterSatelliteLinks]
        Coverage[CoverageZones]
    end

    subgraph Satellites_inner["Satellites"]
        SatMarker[SatMarker x N]
        OrbitLine[OrbitLine / VirtualOrbitLine]
        CubeSat1U
        CubeSat3U
    end

    Scene3D --> Scene3D_inner
    Sats --> Satellites_inner

    style App fill:#0d1b2a,stroke:#3389ff,color:#d9ecff
    style Scene3D_inner fill:#1b2838,stroke:#33ffaa,color:#d9ecff
    style Satellites_inner fill:#2a1b38,stroke:#aa33ff,color:#d9ecff
```

### Модель данных

```mermaid
erDiagram
    SatelliteInfo {
        int norad_id PK
        string name
        string constellation
        string purpose
        float mass_kg
        string form_factor
        string launch_date
        string status
        string tle_line1
        string tle_line2
    }

    SatellitePosition {
        int norad_id FK
        float x_eci
        float y_eci
        float z_eci
        float altitude_km
        float speed_km_s
        float lat
        float lon
    }

    ISLLink {
        int norad_id_1 FK
        int norad_id_2 FK
        float distance_km
        boolean line_of_sight
        boolean connected
    }

    SatelliteInfo ||--o{ SatellitePosition : "propagated to"
    SatelliteInfo ||--o{ ISLLink : "linked with"
```

### Орбитальная механика

```mermaid
graph TD
    TLE[TLE Data] -->|twoline2rv| Satrec[SGP4 Satrec Object]
    Satrec -->|sgp4 jd, fr| ECI[ECI Position x,y,z]
    ECI -->|scale 1/R_E| Scene[Scene Coordinates]
    ECI -->|GMST rotation| Geo[Lat/Lon]

    subgraph Virtual["Виртуальные орбиты"]
        Params[N, Alt, Planes] -->|Walker-delta| RAAN[RAAN per plane]
        RAAN --> Kepler[Kepler Equation]
        Kepler --> VECI[Virtual ECI]
        VECI --> Scene
    end

    subgraph ISL_Calc["Расчёт МСС"]
        ECI --> Pairs[All Pairs N2]
        Pairs --> Distance[Distance Check]
        Pairs --> LOS[LOS Check]
        Distance --> Link[Link Status]
        LOS --> Link
    end

    style Virtual fill:#1b2838,stroke:#33ffaa,color:#d9ecff
    style ISL_Calc fill:#2a1b38,stroke:#aa33ff,color:#d9ecff
```

### Ключевые архитектурные решения

- **Клиентская SGP4**: `satellite.js` на фронтенде для плавной покадровой анимации без сетевой задержки
- **Shared simClock**: единый источник времени для синхронизации камеры, спутников и МСС
- **Zustand Store**: легковесное управление состоянием
- **Виртуальные орбиты**: при `orbitAltitudeKm > 0` генерируются аналитические круговые Walker-орбиты
- **LOS-проверка**: геометрический тест луч-сфера для обнаружения затенения Землёй
- **CelesTrak интеграция**: автоматическая подгрузка TLE с кэшированием (1 час TTL) и fallback на встроенные данные

---

## Быстрый старт

### Требования
- **Node.js** >= 18.0, **npm** >= 9.0
- **Python** >= 3.10
- Современный браузер (Chrome 90+, Firefox 90+, Safari 15+)

### Бэкенд

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env           # Добавить OPENROUTER_API_KEY для StarAI (опционально)
uvicorn main:app --reload --port 8000
```

### Фронтенд

```bash
cd frontend
npm install
npm run dev                    # -> http://localhost:3000
```

Фронтенд автоматически проксирует `/api/*` на `localhost:8000` (настроено в `vite.config.ts`).

---

## Спутники

| Группировка | Спутники | Назначение | Форм-фактор |
|---|---|---|---|
| **УниверСат** | Декарт (46493), НОРБИ (46494), НОРБИ-2 (57179), СамСат-Ионосфера (61784) | ДЗЗ, AIS, радиация, ионосфера | 3U / 6U |
| **МГТУ Баумана** | Ярило-1 (46490), УмКА-1 (57172), Ярило-3 (57198) | Солнечная физика, технодемонстрация | 1.5U / 3U |
| **SPUTNIX** | CubeSX-HSE (47952), CubeSX-HSE-3 (57178) | ДЗЗ, технологические эксперименты | 3U |
| **Геоскан** | Геоскан-Эдельвейс (53385) ⚠ деорбитирован | Испытание платформы, двигатель | 3U |
| **НИИЯФ МГУ** | Монитор-2 (57184) | Рентген/гамма-наблюдения | 3U |
| **Space-Pi** | TUSUR GO (61782), RTU MIREA-1 (61785), Горизонт (61757), ASRTU-1 (61781) | Образовательные, научные | 3U |

---

## Структура проекта

```
StarVision/
├── backend/
│   ├── main.py               # FastAPI эндпоинты
│   ├── satellites.py         # Каталог 15 российских КА + TLE
│   ├── orbital.py            # SGP4-пропагация, ECI → геодезические
│   ├── celestrak.py          # Загрузка TLE с CelesTrak + кэш
│   ├── ai_assistant.py       # StarAI — OpenRouter API + оффлайн fallback
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── Scene3D.tsx            # Canvas (R3F), CameraController
│       │   ├── Earth.tsx              # NASA Blue Marble + Suspense fallback
│       │   ├── Satellites.tsx         # SGP4, 2 модели CubeSat, Walker-орбиты
│       │   ├── InterSatelliteLinks.tsx # МСС: per-frame, LOS, пулинг объектов
│       │   ├── CoverageZones.tsx      # Зоны покрытия
│       │   ├── ControlPanel.tsx       # Скорость, ползунки, переключатели, TLE-источник
│       │   ├── Header.tsx             # UTC, статус, переключатель языка
│       │   ├── SatelliteInfoPanel.tsx # Телеметрия выбранного КА
│       │   └── StarAIChat.tsx         # ИИ-ассистент с командами UI
│       ├── hooks/useStore.ts          # Zustand-хранилище
│       ├── i18n.ts                    # Мультиязычность RU/EN
│       ├── services/api.ts            # REST API клиент
│       ├── simClock.ts                # Общие часы симуляции
│       └── types.ts                   # TypeScript-интерфейсы
├── docs/
│   └── EN.md                 # Документация на английском
├── ROADMAP.md
└── README.md
```

---

## Технологический стек

| Компонент | Технология | Лицензия |
|---|---|---|
| Фронтенд | React 18 + TypeScript | MIT |
| 3D-движок | Three.js / React Three Fiber / Drei | MIT |
| Орбитальная механика (клиент) | satellite.js | MIT |
| UI-фреймворк | Tailwind CSS | MIT |
| Состояние | Zustand | MIT |
| Бэкенд | Python FastAPI | MIT |
| Орбитальная механика (сервер) | python-sgp4 | MIT |
| ИИ-ассистент | OpenRouter API (серверный) | — |
| Сборщик | Vite | MIT |

---

## API-эндпоинты

| Метод | URL | Описание |
|---|---|---|
| GET | `/api/health` | Состояние бэкенда, кэш CelesTrak, каталог |
| GET | `/api/satellites` | Список всех КА (активные + архивные) |
| GET | `/api/satellites/{norad_id}` | Метаданные конкретного КА |
| GET | `/api/positions` | Текущие ECI/гео координаты (только операционные) |
| GET | `/api/tle?source=embedded\|celestrak` | TLE + meta (effective_source, live/fallback) |
| GET | `/api/tle/status` | Снапшот кэша TLE (возраст, TTL, ошибка) |
| POST | `/api/tle/refresh` | Принудительное обновление TLE с CelesTrak |
| GET | `/api/orbit/{norad_id}` | Орбитальный трек — 409 для архивных |
| GET | `/api/orbits` | Батч-выгрузка треков всех операционных КА |
| GET | `/api/links?comm_range_km=2000` | МСС + аналитика связности (50–2000 км) |
| GET | `/api/orbital-elements/{norad_id}` | Кеплеровы элементы — 409 для архивных |
| GET | `/api/collisions` | Прогноз сближений |
| GET | `/api/optimize-planes` | Walker-δ T/P/F с целевой функцией покрытия |
| POST | `/api/starai/chat` | StarAI — чат с JSON-командами UI |
| GET | `/api/config` | Начальная конфигурация фронтенда |

---

## Источники данных

### TLE (Two-Line Element) — орбитальные данные
- **CelesTrak** — https://celestrak.org — автоматическая загрузка TLE для российских КА
- Данные кэшируются на 1 час, с fallback на встроенные при недоступности сервиса
- Переключение между источниками через панель управления (Встроенные / CelesTrak)

### Текстуры Земли
- **NASA Blue Marble** — NASA Earth Observatory / EOSDIS
- Лицензия: NASA Media Usage Guidelines — свободное использование с атрибуцией

### 3D-модели спутников
- **Процедурные модели** на Three.js (BoxGeometry + PlaneGeometry)
  - 1U CubeSat: 10×10×10 мм корпус + 2 солнечные панели
  - 3U CubeSat: 10×30×10 мм корпус + 4 солнечные панели

---

## Безопасность и этика (ТЗ 7.6)

- Все орбитальные данные (TLE) из открытых публичных источников (CelesTrak)
- Текстуры Земли используются по NASA Media Usage Guidelines
- 3D-модели спутников созданы самостоятельно (процедурная генерация Three.js)
- Все библиотеки имеют открытую MIT-лицензию
- Лицензия проекта: Unlicense (общественное достояние)

---

## Документация

- [Документация на русском (docs/RU.md)](docs/RU.md)
- [English documentation (docs/EN.md)](docs/EN.md)

---

## Ссылки

| Проект | Описание |
|---|---|
| [Stuff in Space](https://stuffin.space) | Интерактивная карта спутников на Three.js |
| [NASA Eyes on the Earth](https://eyes.nasa.gov/apps/earth) | 3D-визуализация спутников NASA |
| [CesiumJS](https://cesium.com/platform/cesiumjs) | 3D-глобус с поддержкой анимации спутников |
| [satellite.js](https://github.com/shashwatak/satellite-js) | SGP4-пропагация для JavaScript |
