// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CollisionPanel } from '../components/CollisionPanel';
import { OptimizerPanel } from '../components/OptimizerPanel';
import { useStore } from '../hooks/useStore';

const { fetchCollisionsMock, fetchOptimizePlanesMock } = vi.hoisted(() => ({
  fetchCollisionsMock: vi.fn(),
  fetchOptimizePlanesMock: vi.fn(),
}));

vi.mock('../services/api', () => ({
  fetchCollisions: fetchCollisionsMock,
  fetchOptimizePlanes: fetchOptimizePlanesMock,
  ApiError: class ApiError extends Error {
    status: number;
    detail: string;

    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('panel stale-state regressions', () => {
  beforeEach(() => {
    useStore.getState().resetView();
    useStore.setState({
      lang: 'en',
      toasts: [],
      events: [],
    });
    fetchCollisionsMock.mockReset();
    fetchOptimizePlanesMock.mockReset();
  });

  it('clears collision results when the mode changes', async () => {
    useStore.getState().setOrbitAltitudeKm(550);
    fetchCollisionsMock.mockResolvedValue({
      close_approaches: [{
        norad_id_1: 90000,
        name_1: 'VirtSat-1',
        norad_id_2: 90001,
        name_2: 'VirtSat-2',
        min_distance_km: 42.5,
        time_of_closest_approach: '2026-04-01T12:00:00Z',
        risk_level: 'warning',
      }],
      count: 1,
      threshold_km: 100,
      hours_ahead: 24,
      source: 'virtual',
      mode: 'virtual',
      timestamp: '2026-04-01T12:00:00Z',
    });

    render(<CollisionPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Collision forecast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run forecast' }));

    await screen.findByText('VirtSat-1 ↔ VirtSat-2');

    act(() => {
      useStore.getState().setOrbitAltitudeKm(0);
    });

    await waitFor(() => {
      expect(screen.queryByText('VirtSat-1 ↔ VirtSat-2')).toBeNull();
    });
    expect(screen.getByText(/Calculation mode: Real TLE/i)).toBeTruthy();
  });

  it('ignores stale collision responses after parameters change', async () => {
    useStore.getState().setOrbitAltitudeKm(550);
    const pending = deferred<any>();
    fetchCollisionsMock.mockReturnValueOnce(pending.promise);

    render(<CollisionPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Collision forecast' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run forecast' }));

    act(() => {
      useStore.getState().setOrbitAltitudeKm(0);
    });

    await act(async () => {
      pending.resolve({
        close_approaches: [{
          norad_id_1: 90000,
          name_1: 'VirtSat-1',
          norad_id_2: 90001,
          name_2: 'VirtSat-2',
          min_distance_km: 42.5,
          time_of_closest_approach: '2026-04-01T12:00:00Z',
          risk_level: 'warning',
        }],
        count: 1,
        threshold_km: 100,
        hours_ahead: 24,
        source: 'virtual',
        mode: 'virtual',
        timestamp: '2026-04-01T12:00:00Z',
      });
      await pending.promise;
    });

    await waitFor(() => {
      expect(screen.queryByText('VirtSat-1 ↔ VirtSat-2')).toBeNull();
    });
    expect(screen.getByText(/Calculation mode: Real TLE/i)).toBeTruthy();
  });

  it('clears optimizer result when source parameters change externally', async () => {
    fetchOptimizePlanesMock.mockResolvedValue({
      walker_notation: '12/3/1',
      total_satellites: 12,
      num_planes: 3,
      sats_per_plane: 4,
      phase_factor: 1,
      altitude_km: 550,
      inclination_deg: 55,
      orbital_period_min: 95.4,
      velocity_km_s: 7.61,
      planes: [],
      coverage_note: 'legacy',
    });

    render(<OptimizerPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Walker optimizer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));

    await screen.findByText('12/3/1');

    act(() => {
      useStore.getState().setInclinationDeg(77);
    });

    await waitFor(() => {
      expect(screen.queryByText('12/3/1')).toBeNull();
    });
  });

  it('ignores stale optimizer responses after external parameter changes', async () => {
    const pending = deferred<any>();
    fetchOptimizePlanesMock.mockReturnValueOnce(pending.promise);

    render(<OptimizerPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Walker optimizer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));

    act(() => {
      useStore.getState().setInclinationDeg(77);
    });

    await act(async () => {
      pending.resolve({
        walker_notation: '12/3/1',
        total_satellites: 12,
        num_planes: 3,
        sats_per_plane: 4,
        phase_factor: 1,
        altitude_km: 550,
        inclination_deg: 55,
        orbital_period_min: 95.4,
        velocity_km_s: 7.61,
        planes: [],
        coverage_note: 'legacy',
      });
      await pending.promise;
    });

    await waitFor(() => {
      expect(screen.queryByText('12/3/1')).toBeNull();
    });
  });
});
