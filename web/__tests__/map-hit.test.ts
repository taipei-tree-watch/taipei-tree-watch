import { describe, expect, it } from 'vitest';

import { TAP_RADIUS_PX, pickHit } from '../src/map/hit.ts';

const PRIORITY = ['reports-points', 'reports-clusters', 'trees-points'];

describe('pickHit', () => {
  it('is null when nothing was under the tap', () => {
    expect(pickHit([], PRIORITY)).toBeNull();
  });

  it('returns the only candidate', () => {
    const tree = { layerId: 'trees-points', id: 'T1' };
    expect(pickHit([tree], PRIORITY)).toBe(tree);
  });

  it('prefers a report over a protected tree it is drawn on', () => {
    const tree = { layerId: 'trees-points', id: 'T1' };
    const report = { layerId: 'reports-points', id: 'R1' };
    expect(pickHit([tree, report], PRIORITY)).toBe(report);
  });

  it('prefers a report over a cluster', () => {
    const cluster = { layerId: 'reports-clusters', id: 'C1' };
    const report = { layerId: 'reports-points', id: 'R1' };
    expect(pickHit([cluster, report], PRIORITY)).toBe(report);
  });

  it('prefers a cluster over a protected tree', () => {
    const tree = { layerId: 'trees-points', id: 'T1' };
    const cluster = { layerId: 'reports-clusters', id: 'C1' };
    expect(pickHit([tree, cluster], PRIORITY)).toBe(cluster);
  });

  it('keeps the first candidate when several share the winning layer', () => {
    const near = { layerId: 'reports-points', id: 'R1' };
    const far = { layerId: 'reports-points', id: 'R2' };
    expect(pickHit([near, far], PRIORITY)).toBe(near);
  });

  it('ignores a layer the caller did not rank', () => {
    const other = { layerId: 'basemap-raster', id: 'B1' };
    expect(pickHit([other], PRIORITY)).toBeNull();
  });

  it('queries a box wide enough for a finger', () => {
    expect(TAP_RADIUS_PX).toBeGreaterThanOrEqual(10);
  });
});
