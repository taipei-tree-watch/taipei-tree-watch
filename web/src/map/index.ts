/**
 * The map surface: basemap, orthophoto, protected tree layer and report layer.
 *
 * The controller owns the MapLibre instance and is the only module that talks
 * to it. Everything the rest of the page needs goes through the returned
 * interface, including getCenter, getZoom and onMove, which the crosshair
 * picker builds on without reaching into the map itself.
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import type {
  GeoJSONSource,
  LngLatLike,
  MapLayerMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import { AttributionControl, MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
// MapLibre derives its worker URL from its own module URL, which no longer
// resolves once the library is bundled. Pointing it at the worker the bundler
// emitted keeps the worker, and therefore every GeoJSON layer, self hosted.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { ACTIVE_ORTHO, BASE_MAP, INITIAL_VIEW, MAP_ATTRIBUTION } from '../basemaps.ts';
import type { ReportRecord } from '../data/snapshot.ts';
import type { ProtectedTree } from '../data/trees.ts';
import {
  CLUSTER_ALERT_COLOR,
  CLUSTER_COLOR,
  PROTECTED_TREE_COLOR,
  bucketForCauses,
  colorForCauses,
} from './colors.ts';

setWorkerUrl(workerUrl);

const REPORTS_SOURCE = 'reports';
const TREES_SOURCE = 'trees';

export const LAYER_IDS = {
  basemap: 'basemap-raster',
  ortho: 'ortho-raster',
  trees: 'trees-points',
  clusters: 'reports-clusters',
  reports: 'reports-points',
} as const;

export interface MapView {
  readonly lat: number;
  readonly lng: number;
  readonly zoom: number;
}

export interface MapController {
  /** Current map centre, which the crosshair picker reads as the chosen point. */
  getCenter(): { lat: number; lng: number };
  getZoom(): number;
  /** Subscribe to camera changes; returns an unsubscribe function. */
  onMove(listener: (view: MapView) => void): () => void;
  onReportClick(listener: (id: string) => void): () => void;
  onTreeClick(listener: (id: string) => void): () => void;
  setReports(reports: readonly ReportRecord[]): void;
  setTrees(trees: readonly ProtectedTree[]): void;
  setOrthoVisible(visible: boolean): void;
  isOrthoVisible(): boolean;
  flyTo(center: { lat: number; lng: number }, zoom?: number): void;
  resize(): void;
}

function emptyCollection(): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: [] };
}

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      [BASE_MAP.id]: {
        type: 'raster',
        tiles: [...BASE_MAP.tiles],
        tileSize: BASE_MAP.tileSize,
        minzoom: BASE_MAP.minzoom,
        maxzoom: BASE_MAP.maxzoom,
      },
      [ACTIVE_ORTHO.id]: {
        type: 'raster',
        tiles: [...ACTIVE_ORTHO.tiles],
        tileSize: ACTIVE_ORTHO.tileSize,
        minzoom: ACTIVE_ORTHO.minzoom,
        maxzoom: ACTIVE_ORTHO.maxzoom,
        ...(ACTIVE_ORTHO.bounds === undefined ? {} : { bounds: [...ACTIVE_ORTHO.bounds] }),
      },
      [TREES_SOURCE]: { type: 'geojson', data: emptyCollection() },
      [REPORTS_SOURCE]: {
        type: 'geojson',
        data: emptyCollection(),
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 15,
        // Counts brown root rot members so a cluster can warn before it opens.
        clusterProperties: {
          alert: ['+', ['case', ['==', ['get', 'bucket'], 'brown-root-rot'], 1, 0]],
        },
      },
    },
    layers: [
      { id: LAYER_IDS.basemap, type: 'raster', source: BASE_MAP.id },
      {
        id: LAYER_IDS.ortho,
        type: 'raster',
        source: ACTIVE_ORTHO.id,
        layout: { visibility: 'none' },
      },
      {
        id: LAYER_IDS.trees,
        type: 'circle',
        source: TREES_SOURCE,
        paint: {
          'circle-color': PROTECTED_TREE_COLOR,
          'circle-opacity': 0.8,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            1.4,
            14,
            2.6,
            18,
            5,
          ],
        },
      },
      {
        id: LAYER_IDS.clusters,
        type: 'circle',
        source: REPORTS_SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'case',
            ['>', ['get', 'alert'], 0],
            CLUSTER_ALERT_COLOR,
            CLUSTER_COLOR,
          ],
          'circle-opacity': 0.82,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-radius': ['step', ['get', 'point_count'], 13, 10, 18, 50, 24, 200, 30],
        },
      },
      {
        id: LAYER_IDS.reports,
        type: 'circle',
        source: REPORTS_SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            ['case', ['==', ['get', 'bucket'], 'brown-root-rot'], 5, 3.5],
            16,
            ['case', ['==', ['get', 'bucket'], 'brown-root-rot'], 11, 8],
          ],
        },
      },
    ],
  };
}

function reportFeature(report: ReportRecord): Feature<Point> {
  const bucket = bucketForCauses(report.causes);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [report.lng, report.lat] },
    properties: {
      id: report.id,
      bucket,
      color: colorForCauses(report.causes),
    },
  };
}

function treeFeature(tree: ProtectedTree): Feature<Point> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [tree.lng, tree.lat] },
    properties: { id: tree.id },
  };
}

export function createMapController(container: HTMLElement): MapController {
  const map = new MapLibreMap({
    container,
    style: buildStyle(),
    center: [INITIAL_VIEW.center[0], INITIAL_VIEW.center[1]] as LngLatLike,
    zoom: INITIAL_VIEW.zoom,
    minZoom: INITIAL_VIEW.minZoom,
    maxZoom: INITIAL_VIEW.maxZoom,
    attributionControl: false,
  });

  map.addControl(
    new AttributionControl({ compact: false, customAttribution: MAP_ATTRIBUTION }),
    'bottom-right',
  );
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

  // The container tracks the viewport, which changes without a window resize
  // event when a phone's address bar collapses or the pane is re-laid out.
  new ResizeObserver(() => {
    map.resize();
  }).observe(container);

  let loaded = false;
  const pending = new Map<string, FeatureCollection<Point>>();

  const applyData = (source: string, data: FeatureCollection<Point>): void => {
    if (!loaded) {
      pending.set(source, data);
      return;
    }
    const geojson = map.getSource(source) as GeoJSONSource | undefined;
    geojson?.setData(data);
  };

  map.on('load', () => {
    loaded = true;
    for (const [source, data] of pending) {
      const geojson = map.getSource(source) as GeoJSONSource | undefined;
      geojson?.setData(data);
    }
    pending.clear();
  });

  const pointerLayers = [LAYER_IDS.reports, LAYER_IDS.clusters, LAYER_IDS.trees];
  for (const layer of pointerLayers) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
    });
  }

  const reportListeners = new Set<(id: string) => void>();
  const treeListeners = new Set<(id: string) => void>();

  const idFromEvent = (event: MapLayerMouseEvent): string | null => {
    const value = event.features?.[0]?.properties?.id;
    return typeof value === 'string' ? value : null;
  };

  map.on('click', LAYER_IDS.reports, (event) => {
    const id = idFromEvent(event);
    if (id === null) {
      return;
    }
    for (const listener of reportListeners) {
      listener(id);
    }
  });

  map.on('click', LAYER_IDS.trees, (event) => {
    const id = idFromEvent(event);
    if (id === null) {
      return;
    }
    for (const listener of treeListeners) {
      listener(id);
    }
  });

  // Clicking a cluster opens it rather than selecting anything.
  map.on('click', LAYER_IDS.clusters, (event) => {
    const clusterId = event.features?.[0]?.properties?.cluster_id;
    if (typeof clusterId !== 'number') {
      return;
    }
    const source = map.getSource(REPORTS_SOURCE) as GeoJSONSource | undefined;
    if (source === undefined) {
      return;
    }
    void source.getClusterExpansionZoom(clusterId).then((zoom) => {
      map.easeTo({ center: event.lngLat, zoom });
    });
  });

  const moveListeners = new Set<(view: MapView) => void>();
  map.on('move', () => {
    const center = map.getCenter();
    const view: MapView = { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
    for (const listener of moveListeners) {
      listener(view);
    }
  });

  return {
    getCenter() {
      const center = map.getCenter();
      return { lat: center.lat, lng: center.lng };
    },
    getZoom() {
      return map.getZoom();
    },
    onMove(listener) {
      moveListeners.add(listener);
      return () => moveListeners.delete(listener);
    },
    onReportClick(listener) {
      reportListeners.add(listener);
      return () => reportListeners.delete(listener);
    },
    onTreeClick(listener) {
      treeListeners.add(listener);
      return () => treeListeners.delete(listener);
    },
    setReports(reports) {
      applyData(REPORTS_SOURCE, {
        type: 'FeatureCollection',
        features: reports.map(reportFeature),
      });
    },
    setTrees(trees) {
      applyData(TREES_SOURCE, {
        type: 'FeatureCollection',
        features: trees.map(treeFeature),
      });
    },
    setOrthoVisible(visible) {
      const apply = (): void => {
        map.setLayoutProperty(LAYER_IDS.ortho, 'visibility', visible ? 'visible' : 'none');
      };
      if (loaded) {
        apply();
      } else {
        map.once('load', apply);
      }
    },
    isOrthoVisible() {
      return map.getLayoutProperty(LAYER_IDS.ortho, 'visibility') !== 'none';
    },
    flyTo(center, zoom) {
      map.flyTo({ center: [center.lng, center.lat], ...(zoom === undefined ? {} : { zoom }) });
    },
    resize() {
      map.resize();
    },
  };
}
