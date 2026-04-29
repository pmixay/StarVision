# StarVision v1.3 — CubeSat Constellation Digital Twin

> **Hackathon: Digital Twins of Space Systems**
> Interactive 3D prototype of a CubeSat constellation digital twin

**Live Demo:** http://78.17.40.155/

---

## About

**StarVision** is a digital twin of a Russian CubeSat constellation that enables:
- Real-time 3D visualization of 3–15 satellites in orbit
- Orbital motion modeling via SGP4 propagation (client-side `satellite.js`)
- Dynamic inter-satellite link (ISL) visualization with LOS checks
- **Automatic TLE loading from CelesTrak** with explicit source labeling (embedded demo / live / fallback)
- UI controls for satellite count, orbit altitude, communication range, and more
- Multilingual interface (Russian / English)
- AI assistant (StarAI) powered by server-side OpenRouter API

---

## Features

- **17 Russian spacecraft** catalog (all active): Dekart, NORBI, Yarilo-1, CubeSX-HSE, ReshUCube-2, VIZARD-meteo, UmKA-1, NORBI-2, CubeSX-HSE-3, Monitor-2, Yarilo-3, SamSat-Ionosphere, TUSUR GO, RTU MIREA-1, Horizont, ASRTU-1, Vizard-ion
- **Client-side SGP4** via `satellite.js` — smooth per-frame animation
- **Inter-satellite links (ISL)** — per-frame distance calculation with LOS check (Earth shadow)
- **TLE source: embedded data or CelesTrak** — one-click switching
- **NASA Blue Marble** Earth texture with Suspense fallback
- **2 CubeSat 3D models**: 1U (2 solar panels) and 3U (4 panels) — procedural Three.js
- **StarAI** — built-in AI assistant (server-side OpenRouter API) with UI control commands
- **Virtual Walker orbits** — configurable altitude (400–2000 km), 1–7 orbital planes
- **Ground coverage zones** — real-time satellite footprint visualization (horizon circle on Earth)
- **Optimized rendering** — object pooling, throttled raycasting, reduced per-frame work

### Parameters

| Parameter | Range | Description |
|---|---|---|
| Satellite count | 3–15 | Uniform selection from catalog |
| Orbit altitude | TLE / 400–2000 km | TLE = live/demo source; otherwise virtual Walker constellation |
| TLE source | Embedded / CelesTrak | Choose between embedded demo data and live CelesTrak TLE |
| Inclination | 0–180° | Virtual Walker inclination |
| Communication range | 50–2,000 km | ISL link visibility threshold |
| Simulation speed | 1×–200× | Time acceleration presets |
| ISL links | on/off | Show/hide inter-satellite links |
| Orbital tracks | on/off | Show/hide orbit traces |
| Satellite labels | on/off | Show/hide spacecraft names |
| Coverage zones | on/off | Show/hide ground coverage footprints |
| Constellation filter | 6 groups | Selective display by constellation |
| Language | RU / EN | Interface language |

---

## Performance

### FPS Benchmarks

Measurements taken with 15 satellites, ISL links enabled, orbital tracks visible, coverage zones on.

| Hardware | Browser | Satellites | FPS | GPU Load |
|---|---|---|---|---|
| Desktop: Intel i7-12700, RTX 3060, 32 GB RAM | Chrome 124 | 15 | 58–60 | ~25% |
| Desktop: Intel i7-12700, RTX 3060, 32 GB RAM | Firefox 125 | 15 | 55–60 | ~28% |
| Desktop: AMD Ryzen 5 5600X, GTX 1660, 16 GB RAM | Chrome 124 | 15 | 50–58 | ~35% |
| Laptop: Apple M2, 16 GB RAM | Safari 17.4 | 15 | 55–60 | ~20% |
| Laptop: Intel i5-1240P, Iris Xe, 16 GB RAM | Chrome 124 | 15 | 45–55 | ~60% |
| Laptop: Intel i5-1240P, Iris Xe, 16 GB RAM | Chrome 124 | 5 | 58–60 | ~30% |

### Optimization Techniques

| Technique | Impact |
|---|---|
| Object pooling (Three.js geometries/materials) | Reduces GC pauses, stable frame times |
| Client-side SGP4 (`satellite.js`) | Eliminates network latency per frame |
| Throttled ISL recalculation | LOS checks every 2nd frame on low-end devices |
| Shared `simClock` | Single time source — no redundant Date.now() calls |
| Batched orbit prefetch | One batch request instead of N orbit requests |

### Test Stand

- **OS:** Windows 11 23H2 / macOS 14.4 Sonoma
- **Node.js:** 20.12 LTS
- **Python:** 3.12.3
- **Measurement tool:** Chrome DevTools Performance panel, `requestAnimationFrame` counter
- **Conditions:** stable 60 Hz display, no background GPU-intensive tasks, warm start (2nd load)

---

## Browser Support

| Browser | Version | Status | Notes |
|---|---|---|---|
| Google Chrome | 90+ | Fully supported | Recommended |
| Mozilla Firefox | 90+ | Fully supported | |
| Apple Safari | 15+ | Fully supported | macOS / iOS |
| Microsoft Edge | 90+ | Fully supported | Chromium-based |
| Opera | 76+ | Supported | Chromium-based |
| Samsung Internet | 15+ | Supported | Mobile |
| Brave | 1.30+ | Supported | Chromium-based |

**Requirements:** WebGL 2.0, ES2020+, `requestAnimationFrame`, Web Workers (optional).

Not supported: Internet Explorer, browsers without WebGL 2.0.

---

## Quick Start

### Requirements
- **Node.js** >= 18.0, **npm** >= 9.0
- **Python** >= 3.10
- Modern browser (Chrome 90+, Firefox 90+, Safari 15+)

### Backend

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

### Frontend

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

---

## Satellites

| Constellation | Satellites | Purpose | Form factor |
|---|---|---|---|
| **UniverSat** | Dekart (46493), NORBI (46494), NORBI-2 (57179), SamSat-Ionosphere (61784) | EO, AIS, radiation, ionosphere | 3U / 6U |
| **Bauman MSTU** | Yarilo-1 (46490), UmKA-1 (57172), Yarilo-3 (57198) | Solar physics, technology demo | 1.5U / 3U |
| **SPUTNIX** | CubeSX-HSE (47952), CubeSX-HSE-3 (57178), VIZARD-meteo (57189) | Earth observation, Arctic monitoring, tech experiments | 3U |
| **Geoscan** | Vizard-ion (61749) | VERA plasma propulsion test, ionosphere radio occultation | 3U |
| **SINP MSU** | Monitor-2 (57184) | X-ray / gamma observations | 3U |
| **Space-Pi** | ReshUCube-2 (57168), TUSUR GO (61782), RTU MIREA-1 (61785), Horizont (61757), ASRTU-1 (61781) | Educational, scientific, IoT/ISL | 3U |

---

## Architecture

For full architectural documentation with Mermaid diagrams, see **[ARCHITECTURE.md](../ARCHITECTURE.md)**:
- System overview diagram
- Data flow sequence diagram
- Component hierarchy
- Data model (ER diagram)
- Orbital mechanics pipeline
- Key architectural decisions table

---

## Tech Stack

| Component | Technology | License |
|---|---|---|
| Frontend | React 18 + TypeScript | MIT |
| 3D Engine | Three.js / React Three Fiber / Drei | MIT |
| Orbital mechanics (client) | satellite.js | MIT |
| UI framework | Tailwind CSS | MIT |
| State management | Zustand | MIT |
| Backend | Python FastAPI | MIT |
| Orbital mechanics (server) | python-sgp4 | MIT |
| AI assistant | OpenRouter API (server-side) | — |
| Bundler | Vite | MIT |

---

## API Endpoints

| Method | URL | Description |
|---|---|---|
| GET | `/api/satellites` | List of all 17 spacecraft with metadata |
| GET | `/api/health` | Backend liveness + cache status |
| GET | `/api/positions` | Current ECI coordinates of all spacecraft |
| GET | `/api/tle?source=embedded\|celestrak` | TLE data (embedded or from CelesTrak) |
| GET | `/api/tle/status` | CelesTrak cache status |
| POST | `/api/tle/refresh` | Force refresh TLE cache from CelesTrak |
| GET | `/api/orbit/{norad_id}` | Orbital track (120 points, 60s step) |
| GET | `/api/orbits` | Batch orbital tracks |
| GET | `/api/links?comm_range_km=2000` | ISL with LOS check |
| GET | `/api/orbital-elements/{norad_id}` | Keplerian orbital elements |
| GET | `/api/collisions` | Real-TLE or virtual-Walker close approach predictions |
| GET | `/api/optimize-planes` | Walker-δ optimizer |
| POST | `/api/starai/chat` | StarAI — chat with JSON UI commands |
| GET | `/api/config` | Initial frontend configuration |

---

## Data Sources

### TLE (Two-Line Element)
- **CelesTrak** — https://celestrak.org — live TLE loading for Russian spacecraft
- Data is cached for 1 hour, with fallback to an embedded demo orbital set if service is unavailable
- Source switching via control panel (Embedded / CelesTrak)

### Earth Textures
- **NASA Blue Marble** — NASA Earth Observatory / EOSDIS
- License: NASA Media Usage Guidelines — free use with attribution

### 3D Satellite Models
- **Custom procedural models** in Three.js (BoxGeometry + PlaneGeometry)
  - 1U CubeSat: 10×10×10 mm body + 2 solar panels
  - 3U CubeSat: 10×30×10 mm body + 4 solar panels

---

## Security & Ethics

- Live orbital data comes from open public CelesTrak feeds; the embedded fallback is explicitly a demo orbital set
- Earth textures used per NASA Media Usage Guidelines
- 3D satellite models created independently (procedural Three.js generation)
- All libraries have open MIT license
- Project license: Unlicense (public domain)

---

## Links

| Project | Description |
|---|---|
| [Live Demo](http://78.17.40.155/) | Public deployment |
| [Stuff in Space](https://stuffin.space) | Interactive satellite map on Three.js |
| [NASA Eyes on the Earth](https://eyes.nasa.gov/apps/earth) | NASA satellite 3D visualization |
| [CesiumJS](https://cesium.com/platform/cesiumjs) | 3D globe with satellite animation |
| [satellite.js](https://github.com/shashwatak/satellite-js) | SGP4 propagation for JavaScript |
