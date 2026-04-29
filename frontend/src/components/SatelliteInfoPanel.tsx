import { useMemo, useState, useEffect, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { t, tConstellation } from '../i18n';
import { getSimTime } from '../simClock';
import { CONSTELLATION_NAMES } from '../constants';
import { computeVirtualECI, EARTH_RADIUS_KM, EARTH_MU_KM3_S2 } from '../lib/orbital';
import type { SatelliteData, SatellitePosition } from '../types';

interface SatelliteInfoPanelProps {
  satellites: SatelliteData[];
  positions: SatellitePosition[];
}

export function SatelliteInfoPanel({ satellites, positions }: SatelliteInfoPanelProps) {
  const {
    lang, selectedSatellite, selectSatellite, focusSatellite,
    orbitAltitudeKm, orbitalPlanes, satelliteCount, timeSpeed,
    tleData, tleMeta,
  } = useStore();

  const isVirtual = selectedSatellite !== null && selectedSatellite >= 90000;

  const satData = useMemo(
    () => {
      if (!selectedSatellite) return undefined;
      if (isVirtual) {
        const idx = selectedSatellite - 90000;
        return {
          norad_id: selectedSatellite,
          name: `VirtSat-${idx + 1}`,
          constellation: CONSTELLATION_NAMES[idx % CONSTELLATION_NAMES.length],
          purpose: lang === 'en' ? 'Virtual satellite' : 'Виртуальный спутник',
          mass_kg: 0,
          form_factor: 'Virtual',
          launch_date: '—',
          status: 'active',
          description: lang === 'en'
            ? `Virtual satellite on circular orbit at ${orbitAltitudeKm} km altitude, ${orbitalPlanes} orbital planes, ${satelliteCount} total S/C.`
            : `Виртуальный спутник на круговой орбите высотой ${orbitAltitudeKm} км, ${orbitalPlanes} плоскостей, ${satelliteCount} КА.`,
        } as SatelliteData;
      }
      return satellites.find((s) => s.norad_id === selectedSatellite);
    },
    [satellites, selectedSatellite, isVirtual, orbitAltitudeKm, orbitalPlanes, satelliteCount, lang]
  );

  const satPos = useMemo(
    () => positions.find((p) => p.norad_id === selectedSatellite),
    [positions, selectedSatellite]
  );

  // Client-side telemetry for virtual satellites (NORAD >= 90000)
  const [virtualTelemetry, setVirtualTelemetry] = useState<SatellitePosition | null>(null);
  // Keep a ref to timeSpeed so the interval callback always reads the latest value
  const timeSpeedRef = useRef(timeSpeed);
  timeSpeedRef.current = timeSpeed;

  useEffect(() => {
    if (!isVirtual || !selectedSatellite) {
      setVirtualTelemetry(null);
      return;
    }
    // Update interval adapts to simulation speed: faster sim → shorter interval so the
    // telemetry panel doesn't lag far behind the 3D position at high time multipliers.
    const BASE_INTERVAL_MS = 500;
    const intervalMs = Math.max(50, BASE_INTERVAL_MS / Math.max(1, timeSpeedRef.current));
    const interval = setInterval(() => {
      const idx = selectedSatellite - 90000;
      const a = EARTH_RADIUS_KM + orbitAltitudeKm;
      const simTimeSec = getSimTime() / 1000;
      const { x, y, z } = computeVirtualECI(idx, satelliteCount, orbitAltitudeKm, simTimeSec, orbitalPlanes);
      const speed = Math.sqrt(EARTH_MU_KM3_S2 / a);
      const periodMin = (2 * Math.PI * Math.sqrt((a * a * a) / EARTH_MU_KM3_S2)) / 60;
      const r = Math.sqrt(x * x + y * y + z * z);
      const lat = Math.asin(z / r) * (180 / Math.PI);
      const lon = Math.atan2(y, x) * (180 / Math.PI);
      setVirtualTelemetry({
        norad_id: selectedSatellite,
        name: `VirtSat-${idx + 1}`,
        eci: { x, y, z },
        velocity: { vx: 0, vy: 0, vz: 0 },
        altitude_km: orbitAltitudeKm,
        speed_km_s: speed,
        period_min: periodMin,
        lat,
        lon,
        timestamp: new Date(getSimTime()).toISOString(),
      });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [isVirtual, selectedSatellite, orbitAltitudeKm, orbitalPlanes, satelliteCount, timeSpeed]);

  const effectivePos = isVirtual ? virtualTelemetry : satPos;

  if (!selectedSatellite || !satData) return null;

  const km = lang === 'ru' ? 'км' : 'km';
  const kms = lang === 'ru' ? 'км/с' : 'km/s';
  const min = lang === 'ru' ? 'мин' : 'min';
  const kg = lang === 'ru' ? 'кг' : 'kg';

  return (
    <div
      className="glass-panel absolute top-16 right-4 w-80 max-w-[92vw] p-4 animate-slide-right z-10"
      style={{ maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-star-400 animate-pulse-glow" />
          <h3 className="font-display font-bold text-star-100 text-sm">
            {satData.name}
          </h3>
        </div>
        <button
          onClick={() => selectSatellite(null)}
          className="text-star-500 hover:text-star-200 transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            satData.status === 'active' ? 'bg-green-400' : 'bg-red-400'
          }`}
        />
        <span className="text-xs text-star-400 font-mono">
          {satData.status === 'active' ? t('info.active', lang) : t('info.inactive', lang)}
        </span>
        <span className="text-xs text-star-600 font-mono">|</span>
        <span className="text-xs text-star-400 font-mono">{satData.form_factor}</span>
        {!isVirtual && (
          <>
            <span className="text-xs text-star-600 font-mono">|</span>
            <span className="text-xs text-star-400 font-mono">{satData.mass_kg} {kg}</span>
          </>
        )}
      </div>

      {/* Mode / source badge — make it unambiguous whether this is a Real TLE
          satellite or a Virtual Walker slot, so jury and users don't conflate
          real telemetry with synthetic positions. */}
      <div className="mb-3">
        {isVirtual ? (
          <span className="inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
            {t('mode.virtual', lang)}
          </span>
        ) : (
          <span
            className="inline-block text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-300"
            title={tleMeta ? `${tleMeta.effective_source} · ${tleMeta.fetched_at}` : undefined}
          >
            {t('mode.realTle', lang)} ·{' '}
            {(() => {
              const entry = tleData.find((x) => x.norad_id === satData.norad_id);
              const s = entry?.source ?? tleMeta?.effective_source ?? 'embedded';
              if (s === 'celestrak') return 'CelesTrak';
              if (s === 'embedded_fallback') return 'fallback';
              return 'embedded';
            })()}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-star-300 font-body mb-4 leading-relaxed">
        {satData.description}
      </p>

      {/* Telemetry */}
      {effectivePos && (
        <div className="space-y-1 mb-4">
          <SectionTitle>{t('info.telemetry', lang)}</SectionTitle>
          <DataRow label={t('info.altitude', lang)} value={`${effectivePos.altitude_km.toFixed(1)} ${km}`} />
          <DataRow label={t('info.velocity', lang)} value={`${effectivePos.speed_km_s.toFixed(3)} ${kms}`} />
          <DataRow label={t('info.period', lang)} value={`${effectivePos.period_min.toFixed(1)} ${min}`} />
          <DataRow label={t('info.latitude', lang)} value={`${effectivePos.lat.toFixed(2)}°`} />
          <DataRow label={t('info.longitude', lang)} value={`${effectivePos.lon.toFixed(2)}°`} />
        </div>
      )}

      {/* ECI coordinates */}
      {effectivePos && (
        <div className="space-y-1 mb-4">
          <SectionTitle>{t('info.eciCoords', lang)}</SectionTitle>
          <DataRow label="X" value={effectivePos.eci.x.toFixed(1)} />
          <DataRow label="Y" value={effectivePos.eci.y.toFixed(1)} />
          <DataRow label="Z" value={effectivePos.eci.z.toFixed(1)} />
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-1">
        <SectionTitle>{t('info.metadata', lang)}</SectionTitle>
        <DataRow label={t('info.noradId', lang)} value={String(satData.norad_id)} />
        <DataRow label={t('info.constellation', lang)} value={tConstellation(satData.constellation, lang)} />
        <DataRow label={t('info.purpose', lang)} value={satData.purpose} />
        {!isVirtual && (
          <DataRow label={t('info.launch', lang)} value={satData.launch_date} />
        )}
      </div>

      {/* Focus button */}
      <button
        onClick={() => focusSatellite(selectedSatellite)}
        className="btn-star w-full mt-4 text-xs py-2"
      >
        {t('info.focusCamera', lang)}
      </button>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-star-500 font-mono uppercase tracking-widest mb-1 pt-1 border-t border-star-900/50">
      {children}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-[11px] text-star-500 font-body flex-shrink-0">{label}</span>
      <span className="text-[11px] text-star-200 font-mono text-right break-words min-w-0">{value}</span>
    </div>
  );
}
