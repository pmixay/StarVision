import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../hooks/useStore';
import { CONSTELLATION_NAMES } from '../constants';

describe('useStore (Zustand)', () => {
  beforeEach(() => {
    // Reset store to defaults
    useStore.getState().resetView();
  });

  describe('initial state', () => {
    it('has correct default satellite count', () => {
      expect(useStore.getState().satelliteCount).toBe(15);
    });

    it('has correct default comm range', () => {
      expect(useStore.getState().commRangeKm).toBe(2000);
    });

    it('has correct default orbit altitude', () => {
      expect(useStore.getState().orbitAltitudeKm).toBe(0);
    });

    it('has correct default time speed', () => {
      expect(useStore.getState().timeSpeed).toBe(1);
    });

    it('has correct default orbital planes', () => {
      expect(useStore.getState().orbitalPlanes).toBe(3);
    });

    it('has all constellations active', () => {
      expect(useStore.getState().activeConstellations).toEqual(CONSTELLATION_NAMES);
    });

    it('has show flags defaulting correctly', () => {
      const state = useStore.getState();
      expect(state.showOrbits).toBe(true);
      expect(state.showLabels).toBe(true);
      expect(state.showLinks).toBe(true);
      expect(state.showCoverage).toBe(false);
    });

    it('has no satellite selected', () => {
      expect(useStore.getState().selectedSatellite).toBeNull();
      expect(useStore.getState().focusedSatellite).toBeNull();
    });

    it('default TLE source is embedded', () => {
      expect(useStore.getState().tleSource).toBe('embedded');
    });
  });

  describe('setters', () => {
    it('sets satellite count', () => {
      useStore.getState().setSatelliteCount(7);
      expect(useStore.getState().satelliteCount).toBe(7);
    });

    it('clamps satellite count to [3, 15]', () => {
      useStore.getState().setSatelliteCount(2);
      expect(useStore.getState().satelliteCount).toBe(3);
      useStore.getState().setSatelliteCount(99);
      expect(useStore.getState().satelliteCount).toBe(15);
      useStore.getState().setSatelliteCount(-5);
      expect(useStore.getState().satelliteCount).toBe(3);
    });

    it('sets comm range', () => {
      useStore.getState().setCommRangeKm(500);
      expect(useStore.getState().commRangeKm).toBe(500);
    });

    it('clamps comm range to [50, 2000]', () => {
      useStore.getState().setCommRangeKm(10);
      expect(useStore.getState().commRangeKm).toBe(50);
      useStore.getState().setCommRangeKm(99999);
      expect(useStore.getState().commRangeKm).toBe(2000);
    });

    it('sets orbit altitude', () => {
      useStore.getState().setOrbitAltitudeKm(800);
      expect(useStore.getState().orbitAltitudeKm).toBe(800);
    });

    it('clamps orbit altitude — 0 stays 0 (real TLE mode), positives into [400, 2000]', () => {
      useStore.getState().setOrbitAltitudeKm(0);
      expect(useStore.getState().orbitAltitudeKm).toBe(0);
      useStore.getState().setOrbitAltitudeKm(100);
      expect(useStore.getState().orbitAltitudeKm).toBe(400);
      useStore.getState().setOrbitAltitudeKm(5000);
      expect(useStore.getState().orbitAltitudeKm).toBe(2000);
    });

    it('sets time speed', () => {
      useStore.getState().setTimeSpeed(100);
      expect(useStore.getState().timeSpeed).toBe(100);
    });

    it('clamps time speed to [1, 200]', () => {
      useStore.getState().setTimeSpeed(0);
      expect(useStore.getState().timeSpeed).toBe(1);
      useStore.getState().setTimeSpeed(999);
      expect(useStore.getState().timeSpeed).toBe(200);
    });

    it('sets orbital planes', () => {
      useStore.getState().setOrbitalPlanes(5);
      expect(useStore.getState().orbitalPlanes).toBe(5);
    });

    it('clamps orbital planes to [1, 7]', () => {
      useStore.getState().setOrbitalPlanes(0);
      expect(useStore.getState().orbitalPlanes).toBe(1);
      useStore.getState().setOrbitalPlanes(99);
      expect(useStore.getState().orbitalPlanes).toBe(7);
    });

    it('keeps orbital planes within the current satellite count', () => {
      useStore.getState().setOrbitalPlanes(7);
      useStore.getState().setSatelliteCount(5);
      expect(useStore.getState().orbitalPlanes).toBe(5);

      useStore.getState().setOrbitalPlanes(7);
      expect(useStore.getState().orbitalPlanes).toBe(5);
    });

    it('toggles show flags', () => {
      useStore.getState().setShowOrbits(false);
      expect(useStore.getState().showOrbits).toBe(false);
      useStore.getState().setShowLinks(false);
      expect(useStore.getState().showLinks).toBe(false);
    });

    it('sets TLE source', () => {
      useStore.getState().setTleSource('celestrak');
      expect(useStore.getState().tleSource).toBe('celestrak');
    });
  });

  describe('satellite selection', () => {
    it('selects a satellite', () => {
      useStore.getState().selectSatellite(46493);
      expect(useStore.getState().selectedSatellite).toBe(46493);
    });

    it('clears selection and focus on null', () => {
      useStore.getState().focusSatellite(46493);
      useStore.getState().selectSatellite(null);
      expect(useStore.getState().selectedSatellite).toBeNull();
      expect(useStore.getState().focusedSatellite).toBeNull();
      expect(useStore.getState().cameraFollowing).toBe(false);
    });

    it('focus sets cameraFollowing to true', () => {
      useStore.getState().focusSatellite(46493);
      expect(useStore.getState().focusedSatellite).toBe(46493);
      expect(useStore.getState().selectedSatellite).toBe(46493);
      expect(useStore.getState().cameraFollowing).toBe(true);
    });

    it('blocks focus on archival satellite and surfaces an error', () => {
      // Seed the catalog with an archival spacecraft
      useStore.getState().setSatellites([
        {
          norad_id: 53385,
          name: 'Геоскан-Эдельвейс',
          constellation: 'Геоскан',
          purpose: '',
          mass_kg: 4,
          form_factor: '3U',
          launch_date: '2022-08-09',
          status: 'deorbited',
          operational: false,
          archive_date: '2024-02-18',
          description: '',
        },
      ]);
      useStore.getState().setUserError(null);
      useStore.getState().focusSatellite(53385);
      expect(useStore.getState().focusedSatellite).toBeNull();
      expect(useStore.getState().cameraFollowing).toBe(false);
      expect(useStore.getState().userError).not.toBeNull();
    });

    it('blocks selecting an archival satellite', () => {
      useStore.getState().setSatellites([
        {
          norad_id: 53385,
          name: 'Геоскан-Эдельвейс',
          constellation: 'Геоскан',
          purpose: '',
          mass_kg: 4,
          form_factor: '3U',
          launch_date: '2022-08-09',
          status: 'deorbited',
          operational: false,
          archive_date: '2024-02-18',
          description: '',
        },
      ]);
      useStore.getState().selectSatellite(53385);
      expect(useStore.getState().selectedSatellite).toBeNull();
    });
  });

  describe('constellation toggling', () => {
    it('removes a constellation', () => {
      useStore.getState().toggleConstellation('SPUTNIX');
      expect(useStore.getState().activeConstellations).not.toContain('SPUTNIX');
    });

    it('re-adds a constellation', () => {
      useStore.getState().toggleConstellation('SPUTNIX');
      useStore.getState().toggleConstellation('SPUTNIX');
      expect(useStore.getState().activeConstellations).toContain('SPUTNIX');
    });
  });

  describe('chat', () => {
    it('adds a chat message', () => {
      useStore.getState().addChatMessage({
        role: 'user',
        content: 'hello',
        timestamp: Date.now(),
      });
      expect(useStore.getState().chatMessages).toHaveLength(1);
      expect(useStore.getState().chatMessages[0].content).toBe('hello');
    });

    it('limits chat history to 50', () => {
      for (let i = 0; i < 55; i++) {
        useStore.getState().addChatMessage({
          role: 'user',
          content: `msg ${i}`,
          timestamp: Date.now(),
        });
      }
      expect(useStore.getState().chatMessages).toHaveLength(50);
      // Should keep the latest, drop oldest
      expect(useStore.getState().chatMessages[0].content).toBe('msg 5');
    });
  });

  describe('resetView', () => {
    it('resets all parameters to defaults', () => {
      useStore.getState().setSatelliteCount(5);
      useStore.getState().setCommRangeKm(100);
      useStore.getState().setTimeSpeed(200);
      useStore.getState().setOrbitAltitudeKm(1000);
      useStore.getState().setShowOrbits(false);

      useStore.getState().resetView();

      const state = useStore.getState();
      expect(state.satelliteCount).toBe(15);
      expect(state.commRangeKm).toBe(2000);
      expect(state.timeSpeed).toBe(1);
      expect(state.orbitAltitudeKm).toBe(0);
      expect(state.showOrbits).toBe(true);
    });
  });
});
