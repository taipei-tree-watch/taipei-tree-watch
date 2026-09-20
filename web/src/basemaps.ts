/**
 * Every raster tile endpoint and the attribution line, in one place.
 *
 * Switching the orthophoto provider is a one line change to ACTIVE_ORTHO.
 * Tiles are always fetched straight from the provider: nothing is pre-fetched
 * and nothing is copied into storage of our own.
 */
import strings from './ui-strings.json';

export interface RasterBasemap {
  /** Style source and layer id; stable, so layer lookups do not chase the provider. */
  readonly id: string;
  readonly tiles: readonly string[];
  readonly tileSize: number;
  readonly minzoom: number;
  readonly maxzoom: number;
  /** Coverage as [west, south, east, north]; tiles outside are never requested. */
  readonly bounds?: readonly [number, number, number, number];
}

/** NLSC general electronic map. No key, no registration, attribution required. */
export const BASE_MAP: RasterBasemap = {
  id: 'nlsc-emap',
  tiles: ['https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}'],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 20,
};

/**
 * Taipei Department of Urban Development historical imagery, layer Image_3857
 * ("most recent aerial survey", currently the 2021 orthophoto). Its resolution
 * resolves individual tree crowns, which the base map's orthophoto does not,
 * so it is the one the point picker wants.
 *
 * Not wired in: the service forbids redistributing tiles to third parties, and
 * whether a public site's visitors count as third parties is unanswered. This
 * stays here, verified, for the day that question is settled.
 *
 * Style `default` and tile matrix set `GoogleMapsCompatible` come from the
 * service's own GetCapabilities ResourceURL template, which is the only form
 * the service answers; the shorter /WMTS/<layer>/... path returns 404. Bounds
 * are the layer's declared WGS84 bounding box.
 */
export const ORTHO_UDD: RasterBasemap = {
  id: 'udd-ortho',
  tiles: [
    'https://www.historygis.udd.gov.taipei/arcgis/rest/services/Aerial/Ortho_2021/MapServer/WMTS/tile/1.0.0/Aerial_Ortho_2021/default/GoogleMapsCompatible/{z}/{y}/{x}',
  ],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 20,
  bounds: [121.44793706776125, 24.958035579111545, 121.67115596679868, 25.213460888270184],
};

/**
 * NLSC orthophoto, nationwide and under the same open data terms as the base
 * map. Coarser than the city's own imagery, and the one actually in use.
 */
export const ORTHO_NLSC: RasterBasemap = {
  id: 'nlsc-photo2',
  tiles: ['https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 20,
};

/**
 * The orthophoto actually wired into the map. Switching to ORTHO_UDD also
 * means rewording the attribution, which names the imagery's source.
 */
export const ACTIVE_ORTHO: RasterBasemap = ORTHO_NLSC;

/** Shown bottom right at all times; the wording is fixed by the tech spec. */
export const MAP_ATTRIBUTION: string = strings.attribution.map;

/** Map centre and zoom the page opens on: central Taipei, city wide. */
export const INITIAL_VIEW = {
  center: [121.5445, 25.0405] as const,
  zoom: 12,
  minZoom: 9,
  maxZoom: 20,
};
