/**
 * Page bootstrap: paint the shell, then build the map and load both datasets.
 *
 * MapLibre is by far the heaviest script on the page, so it arrives through a
 * dynamic import: the top bar and the status line reach the screen while it is
 * still being parsed. The loaded snapshot is held in memory and the visible
 * report set is re-derived whenever the filter selection changes; a filter
 * change never refetches.
 */
import './style.css';

import { REPORT_BBOX } from './config.ts';
import type { ReportRecord } from './data/snapshot.ts';
import type { ProtectedTree } from './data/trees.ts';
import { loadMapData } from './data/load.ts';
import type { FilterState } from './filters.ts';
import { applyFilters, emptyFilterState } from './filters.ts';
import type { MapController } from './map/index.ts';
import { MIN_SUBMIT_ZOOM } from './report/draft.ts';
import type { PendingReport, StorageLike } from './report/pending.ts';
import { addPending, prunePending, readPending, toReportRecord } from './report/pending.ts';
import strings from './ui-strings.json';
import { createCrosshair } from './ui/crosshair.ts';
import type { Crosshair } from './ui/crosshair.ts';
import { createDetailCard } from './ui/detail-card.ts';
import type { FilterPanel } from './ui/filter-panel.ts';
import { createFilterPanel } from './ui/filter-panel.ts';
import { createInfoPanel } from './ui/info-panel.ts';
import type { ReportForm } from './ui/report-form.ts';
import { createReportForm } from './ui/report-form.ts';
import { createReportSheet } from './ui/report-sheet.ts';
import { createStatusBar } from './ui/status-bar.ts';

function required<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`missing element ${selector}`);
  }
  return element;
}

document.title = strings.app.title;
required<HTMLElement>('#brand').textContent = strings.app.brand;

const filtersToggle = required<HTMLButtonElement>('#filters-toggle');
const infoToggle = required<HTMLButtonElement>('#info-toggle');
const orthoToggle = required<HTMLButtonElement>('#ortho-toggle');
const reportButton = required<HTMLButtonElement>('#report-open');

filtersToggle.textContent = strings.topbar.filters;
infoToggle.textContent = strings.topbar.info;
orthoToggle.textContent = strings.topbar.ortho;
reportButton.textContent = strings.topbar.report;

const statusBar = createStatusBar(required('#status-bar'));
const detailCard = createDetailCard(required('#detail-card'));
const infoPanel = createInfoPanel(required('#info-panel'));
const reportSheet = createReportSheet(required('#report-sheet'));

/** Set once the map module has arrived; the toggles are inert until then. */
let mapController: MapController | null = null;
let filterPanel: FilterPanel | null = null;
let reportForm: ReportForm | null = null;
let crosshair: Crosshair | null = null;

let reports: readonly ReportRecord[] = [];
let trees: readonly ProtectedTree[] = [];
const reportsById = new Map<string, ReportRecord>();
/**
 * Pending points drawn on the map, keyed by id. They are not in the snapshot
 * index, so a tap on one would otherwise find nothing and open no card.
 */
const pendingById = new Map<string, ReportRecord>();
const treesById = new Map<string, ProtectedTree>();

/**
 * Reports this browser has submitted that no snapshot carries yet. Reading
 * localStorage can itself throw where site data is blocked, so the whole
 * access is guarded and the feature simply goes quiet.
 */
function browserStorage(): StorageLike {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('local storage is unavailable', error);
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
  }
}

const storage = browserStorage();
let pendingReports: readonly PendingReport[] = readPending(storage, new Date());

/** Only one overlay panel is open at a time; on a phone they fill the screen. */
function openOnly(panel: 'filters' | 'info' | null): void {
  filterPanel?.setOpen(panel === 'filters');
  infoPanel.setOpen(panel === 'info');
  filtersToggle.setAttribute('aria-expanded', String(panel === 'filters'));
  infoToggle.setAttribute('aria-expanded', String(panel === 'info'));
}

function refresh(state: FilterState): void {
  const visible = applyFilters(reports, state);
  // Pending points are added after filtering, never through it: someone who
  // has just submitted must see their own point even when the active filter
  // would exclude it. The summary still counts the snapshot alone.
  const extra = pendingReports
    .filter((entry) => !reportsById.has(entry.id))
    .map(toReportRecord);
  pendingById.clear();
  for (const entry of extra) {
    pendingById.set(entry.id, entry);
  }
  mapController?.setReports([...visible, ...extra]);
  // The nearby notice is about what has been reported here, not about what
  // the active filter happens to show, so it reads the whole set.
  reportForm?.setReports([...reports, ...extra]);
  filterPanel?.setSummary(visible.length, reports.length, trees.length);
}

filtersToggle.addEventListener('click', () => {
  openOnly(filterPanel?.isOpen() === true ? null : 'filters');
});

infoToggle.addEventListener('click', () => {
  openOnly(infoPanel.isOpen() ? null : 'info');
});

/** Keep the layer and the chip in step, whoever changed it. */
function setOrtho(visible: boolean): void {
  mapController?.setOrthoVisible(visible);
  orthoToggle.setAttribute('aria-pressed', String(visible));
}

orthoToggle.addEventListener('click', () => {
  setOrtho(orthoToggle.getAttribute('aria-pressed') !== 'true');
});

/**
 * Orthophoto state from before picking mode turned it on.
 *
 * Read from the chip rather than from the layer: the layer cannot be queried
 * until the style has loaded, and picking can start before that. Null means
 * picking is not active, so re-entering does not overwrite the saved value.
 */
let orthoBeforePicking: boolean | null = null;

function orthoChipPressed(): boolean {
  return orthoToggle.getAttribute('aria-pressed') === 'true';
}

function enterPicking(): void {
  if (mapController === null) {
    return;
  }
  crosshair?.setVisible(true);
  orthoBeforePicking ??= orthoChipPressed();
  setOrtho(true);
}

function exitPicking(): void {
  crosshair?.setVisible(false);
  if (orthoBeforePicking === null) {
    return;
  }
  setOrtho(orthoBeforePicking);
  orthoBeforePicking = null;
}

/** GPS only ever moves the camera; the crosshair decides the coordinates. */
function locate(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const controller = mapController;
    if (controller === null || !('geolocation' in navigator)) {
      reject(new Error('geolocation is unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        controller.flyTo(
          { lat: position.coords.latitude, lng: position.coords.longitude },
          Math.max(controller.getZoom(), MIN_SUBMIT_ZOOM),
        );
        resolve();
      },
      (error) => {
        reject(new Error(`geolocation failed: ${error.message}`));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

reportButton.addEventListener('click', () => {
  openOnly(null);
  detailCard.hide();
  reportSheet.open();
});

async function load(): Promise<void> {
  statusBar.showLoading();
  const result = await loadMapData();

  if (result.snapshot !== null) {
    reports = result.snapshot.reports;
    reportsById.clear();
    for (const report of reports) {
      reportsById.set(report.id, report);
    }
    // Only a snapshot that actually loaded may retire a pending point.
    pendingReports = prunePending(storage, new Set(reportsById.keys()), new Date());
  }

  if (result.trees !== null) {
    trees = result.trees.trees;
    treesById.clear();
    for (const tree of trees) {
      treesById.set(tree.id, tree);
    }
    mapController?.setTrees(trees);
    reportForm?.setTrees(trees);
    infoPanel.setProtectedTreesFetchedAt(result.trees.fetchedAt);
  }

  refresh(filterPanel?.getState() ?? emptyFilterState());

  if (result.snapshotFailed && result.treesFailed) {
    statusBar.showError(strings.status.bothFailed, () => void load());
    return;
  }
  if (result.snapshotFailed) {
    statusBar.showError(strings.status.snapshotFailed, () => void load());
    return;
  }
  if (result.treesFailed) {
    statusBar.showError(strings.status.treesFailed, () => void load());
    return;
  }
  statusBar.hide();
}

async function start(): Promise<void> {
  statusBar.showLoading();

  const { createMapController } = await import('./map/index.ts');
  const controller = createMapController(required('#map'));
  mapController = controller;
  filterPanel = createFilterPanel(required('#filter-panel'), refresh);
  crosshair = createCrosshair(document.body);

  reportForm = createReportForm(reportSheet.contentElement, {
    getView: () => ({ ...controller.getCenter(), zoom: controller.getZoom() }),
    bbox: REPORT_BBOX,
    locate,
    onPendingReport(entry) {
      pendingReports = addPending(storage, entry, new Date());
      refresh(filterPanel?.getState() ?? emptyFilterState());
    },
    onModeChange() {
      controller.resize();
    },
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
    storage,
  });
  reportForm.setTrees(trees);
  reportForm.setReports(reports);

  reportSheet.onOpenChange((open) => {
    if (open) {
      enterPicking();
    } else {
      exitPicking();
    }
    reportForm?.setActive(open);
  });

  controller.onMove(() => {
    if (reportSheet.isOpen()) {
      reportForm?.update();
    }
  });

  mapController.onReportClick((id) => {
    const report = reportsById.get(id) ?? pendingById.get(id);
    if (report !== undefined) {
      detailCard.showReport(report);
    }
  });

  mapController.onTreeClick((id) => {
    const tree = treesById.get(id);
    if (tree !== undefined) {
      detailCard.showTree(tree);
    }
  });

  await load();
}

void start();
