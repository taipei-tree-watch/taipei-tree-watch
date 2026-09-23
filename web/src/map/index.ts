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
  ExpressionSpecification,
  GeoJSONSource,
  LngLatLike,
  PointLike,
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
import type { MapPalette } from './colors.ts';
import { bucketForCauses, paletteFor } from './colors.ts';
import type { ColorScheme } from '../theme.ts';
import { TAP_RADIUS_PX, pickHit } from './hit.ts';

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
  /** Repaint the basemap and every point layer in the given colour scheme. */
  setColorScheme(scheme: ColorScheme): void;
  isOrthoVisible(): boolean;
  flyTo(center: { lat: number; lng: number }, zoom?: number): void;
  /**
   * Freeze or release the camera. Frozen, no gesture, zoom button or tap on a
   * point moves the map, so the point under the crosshair stays put.
   */
  setInteractive(enabled: boolean): void;
  resize(): void;
}

function emptyCollection(): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * Basemap paint per scheme. NLSC EMAP is a light map with dark labels, so in
 * dark mode the raster is inverted by running its brightness ramp backwards
 * (min above max): the paper turns near black and the labels turn light, which
 * keeps them readable. Merely dimming the tiles would leave dark labels on a
 * grey sheet at around 3.6:1. Inversion also turns the map's greens magenta,
 * so saturation is pulled most of the way out and contrast is softened, which
 * leaves the report points as the only saturated thing on screen. The paint
 * sits on the basemap layer alone: the orthophoto and the points are untouched.
 */
interface BasemapPaint {
  readonly 'raster-brightness-min': number;
  readonly 'raster-brightness-max': number;
  readonly 'raster-saturation': number;
  readonly 'raster-contrast': number;
}

const BASEMAP_PAINT: Readonly<Record<ColorScheme, BasemapPaint>> = {
  light: {
    'raster-brightness-min': 0,
    'raster-brightness-max': 1,
    'raster-saturation': 0,
    'raster-contrast': 0,
  },
  dark: {
    'raster-brightness-min': 1,
    'raster-brightness-max': 0.08,
    'raster-saturation': -0.72,
    'raster-contrast': -0.08,
  },
};

/** Point fill by cause bucket, so a scheme change is a paint update only. */
function bucketColorExpression(palette: MapPalette): ExpressionSpecification {
  return [
    'match',
    ['get', 'bucket'],
    'brown-root-rot',
    palette.buckets['brown-root-rot'],
    'other-disease',
    palette.buckets['other-disease'],
    'construction',
    palette.buckets.construction,
    palette.buckets.none,
  ];
}

/** Stroke that separates a point from the map, darker for a pending point. */
function strokeColorExpression(palette: MapPalette): ExpressionSpecification {
  return ['case', ['get', 'pending'], palette.pendingStroke, palette.halo];
}

function clusterColorExpression(palette: MapPalette): ExpressionSpecification {
  return ['case', ['>', ['get', 'alert'], 0], palette.clusterAlert, palette.cluster];
}

function buildStyle(scheme: ColorScheme): StyleSpecification {
  const palette = paletteFor(scheme);
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
      {
        id: LAYER_IDS.basemap,
        type: 'raster',
        source: BASE_MAP.id,
        paint: { ...BASEMAP_PAINT[scheme] },
      },
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
          'circle-color': palette.protectedTree,
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
          'circle-color': clusterColorExpression(palette),
          'circle-opacity': 0.82,
          'circle-stroke-width': 2,
          'circle-stroke-color': palette.halo,
          'circle-radius': ['step', ['get', 'point_count'], 13, 10, 18, 50, 24, 200, 30],
        },
      },
      {
        id: LAYER_IDS.reports,
        type: 'circle',
        source: REPORTS_SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': bucketColorExpression(palette),
          // A locally pending report is drawn with a dark ring so the reporter
          // can tell their own unsynced point from one that is in the snapshot.
          'circle-stroke-width': ['case', ['get', 'pending'], 3, 1.5],
          'circle-stroke-color': strokeColorExpression(palette),
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
      pending: report.pending === true,
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

export function createMapController(
  container: HTMLElement,
  scheme: ColorScheme = 'light',
): MapController {
  const map = new MapLibreMap({
    container,
    style: buildStyle(scheme),
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

  /**
   * Tap targets, most specific first. A tap is resolved against all three at
   * once so that overlapping layers cannot each claim the same tap.
   */
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

  const expandCluster = (clusterId: number, center: LngLatLike): void => {
    const source = map.getSource(REPORTS_SOURCE) as GeoJSONSource | undefined;
    if (source === undefined) {
      return;
    }
    void source.getClusterExpansionZoom(clusterId).then((zoom) => {
      map.easeTo({ center, zoom });
    });
  };

  // One handler for the whole map rather than one per layer: the query runs
  // over a box the size of a fingertip, which routinely returns features from
  // several layers, and only the most specific of them should answer the tap.
  let interactive = true;

  map.on('click', (event) => {
    if (!interactive) {
      return;
    }
    const { x, y } = event.point;
    const box: [PointLike, PointLike] = [
      [x - TAP_RADIUS_PX, y - TAP_RADIUS_PX],
      [x + TAP_RADIUS_PX, y + TAP_RADIUS_PX],
    ];
    // Querying a layer the style does not hold throws, and a tap can land
    // before the style has finished loading, so the list is narrowed to the
    // layers that exist at this moment.
    const present = pointerLayers.filter((layer) => map.getLayer(layer) !== undefined);
    if (present.length === 0) {
      return;
    }
    const found = map
      .queryRenderedFeatures(box, { layers: present })
      .map((feature) => ({ layerId: feature.layer.id, feature }));
    const hit = pickHit(found, pointerLayers);
    if (hit === null) {
      return;
    }

    const properties = hit.feature.properties ?? {};

    if (hit.layerId === LAYER_IDS.clusters) {
      // A cluster says where to zoom rather than what to select.
      if (typeof properties.cluster_id === 'number') {
        expandCluster(properties.cluster_id, event.lngLat);
      }
      return;
    }

    const id = typeof properties.id === 'string' ? properties.id : null;
    if (id === null) {
      return;
    }
    const listeners = hit.layerId === LAYER_IDS.reports ? reportListeners : treeListeners;
    for (const listener of listeners) {
      listener(id);
    }
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
    setColorScheme(next) {
      const apply = (): void => {
        const palette = paletteFor(next);
        const basemap = BASEMAP_PAINT[next];
        map.setPaintProperty(LAYER_IDS.basemap, 'raster-brightness-min', basemap['raster-brightness-min']);
        map.setPaintProperty(LAYER_IDS.basemap, 'raster-brightness-max', basemap['raster-brightness-max']);
        map.setPaintProperty(LAYER_IDS.basemap, 'raster-saturation', basemap['raster-saturation']);
        map.setPaintProperty(LAYER_IDS.basemap, 'raster-contrast', basemap['raster-contrast']);
        map.setPaintProperty(LAYER_IDS.trees, 'circle-color', palette.protectedTree);
        map.setPaintProperty(LAYER_IDS.clusters, 'circle-color', clusterColorExpression(palette));
        map.setPaintProperty(LAYER_IDS.clusters, 'circle-stroke-color', palette.halo);
        map.setPaintProperty(LAYER_IDS.reports, 'circle-color', bucketColorExpression(palette));
        map.setPaintProperty(LAYER_IDS.reports, 'circle-stroke-color', strokeColorExpression(palette));
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
    setInteractive(enabled) {
      interactive = enabled;
      const handlers = [
        map.dragPan,
        map.scrollZoom,
        map.boxZoom,
        map.dragRotate,
        map.keyboard,
        map.doubleClickZoom,
        map.touchZoomRotate,
        map.touchPitch,
      ];
      for (const handler of handlers) {
        if (enabled) {
          handler.enable();
        } else {
          handler.disable();
        }
      }
      map.getContainer().toggleAttribute('data-frozen', !enabled);
    },
    resize() {
      map.resize();
    },
  };
}
