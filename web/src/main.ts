/**
 * Page bootstrap: paint the shell, then build the map and load both datasets.
 *
 * MapLibre is by far the heaviest script on the page, so it arrives through a
 * dynamic import: the top bar and the status line reach the screen while it is
 * still being parsed. The loaded snapshot is held in memory and the visible
 * report set is re-derived whenever the filter selection changes; a filter
 * change never refetches.
 *
 * An edit link (`?report=<id>&edit=<token>`) is stored in this browser's
 * "my reports" list the moment the page reads it, and the token is taken out
 * of the address bar straight away, so neither the bar nor a share button
 * passes it on. The form then opens on that report.
 */
import './style.css';

import { REPORT_BBOX } from './config.ts';
import type { ReportRecord } from './data/snapshot.ts';
import type { ProtectedTree } from './data/trees.ts';
import { loadMapData } from './data/load.ts';
import type { FilterState } from './filters.ts';
import { applyFilters, emptyFilterState } from './filters.ts';
import type { MapController } from './map/index.ts';
import type { EditLink, PermalinkTarget } from './permalink.ts';
import {
  editLinkUrl,
  parseEditLink,
  parsePermalink,
  permalinkSearch,
  permalinkUrl,
  withoutEditToken,
} from './permalink.ts';
import { MIN_SUBMIT_ZOOM } from './report/draft.ts';
import { readEditableReport } from './report/edit.ts';
import type { StoredEditLink } from './report/edit-links.ts';
import {
  findEditLink,
  readEditLinks,
  removeEditLink,
  saveEditLink,
} from './report/edit-links.ts';
import type { PendingReport, StorageLike } from './report/pending.ts';
import { addPending, prunePending, readPending, toReportRecord } from './report/pending.ts';
import { browserShareCapabilities, sharePermalink } from './share.ts';
import strings from './ui-strings.json';
import { watchDeviceColorScheme } from './theme.ts';
import { createCrosshair } from './ui/crosshair.ts';
import type { Crosshair } from './ui/crosshair.ts';
import { createDetailCard } from './ui/detail-card.ts';
import type { FilterPanel } from './ui/filter-panel.ts';
import { createFilterPanel } from './ui/filter-panel.ts';
import { createInfoPanel } from './ui/info-panel.ts';
import { createMyReportsPanel } from './ui/my-reports-panel.ts';
import { pinToVisualViewport } from './ui/pinned-chrome.ts';
import type { ReportForm } from './ui/report-form.ts';
import { createReportForm } from './ui/report-form.ts';
import { createReportSheet } from './ui/report-sheet.ts';
import { createStatusBar } from './ui/status-bar.ts';

/** Close enough to read a single tree crown, which is what a permalink promises. */
const PERMALINK_ZOOM = 17;

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
const mineToggle = required<HTMLButtonElement>('#mine-toggle');
const orthoToggle = required<HTMLButtonElement>('#ortho-toggle');
const reportButton = required<HTMLButtonElement>('#report-open');
const locateMapButton = required<HTMLButtonElement>('#locate-map');

filtersToggle.textContent = strings.topbar.filters;
infoToggle.textContent = strings.topbar.info;
mineToggle.textContent = strings.topbar.mine;
orthoToggle.textContent = strings.topbar.ortho;
reportButton.textContent = strings.topbar.report;
locateMapButton.textContent = strings.map.locate;

// A pinched phone browser would otherwise leave the bar off screen with no
// way to scroll it back, which takes every control with it.
pinToVisualViewport(required<HTMLElement>('.topbar'));

const statusBar = createStatusBar(required('#status-bar'));

/**
 * A report the permalink named, kept on the map for as long as its card is
 * open even when the active filter excludes it. Following a link and finding
 * an empty map would be the worse outcome, and this leaves the filter rules
 * themselves untouched: the exception is applied where pending points are
 * already added, after filtering rather than through it.
 */
let pinnedReportId: string | null = null;

function addressFor(target: PermalinkTarget | null): void {
  const search = permalinkSearch(target, window.location.search);
  // replaceState rather than pushState: opening a few cards must not turn the
  // back button into a queue the reader has to work through.
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${search}${window.location.hash}`,
  );
}

const shareUrl = (url: string, title: string) =>
  sharePermalink(url, title, browserShareCapabilities(navigator));

const detailCard = createDetailCard(required('#detail-card'), {
  permalinkUrl: (target) => permalinkUrl(target, window.location.href),
  share: shareUrl,
  canEdit: (id) => findEditLink(editLinks, id) !== undefined,
  onEdit(id) {
    const link = findEditLink(editLinks, id);
    if (link !== undefined) {
      void beginEdit(link);
    }
  },
  onTargetChange(target) {
    addressFor(target);
    if (target === null && pinnedReportId !== null) {
      pinnedReportId = null;
      refresh(filterPanel?.getState() ?? emptyFilterState());
    }
  },
});
const infoPanel = createInfoPanel(required('#info-panel'));
infoPanel.onOpenChange((open) => {
  infoToggle.setAttribute('aria-expanded', String(open));
});
const reportSheet = createReportSheet(required('#report-sheet'));
const minePanel = createMyReportsPanel(required('#mine-panel'), {
  onShow(link) {
    openOnly(null);
    showStoredReport(link);
  },
  onEdit(link) {
    openOnly(null);
    void beginEdit(link);
  },
  editLinkUrl: (link) => editLinkUrl(link, window.location.href),
  share: shareUrl,
});
minePanel.onOpenChange((open) => {
  mineToggle.setAttribute('aria-expanded', String(open));
});

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
/**
 * Snapshot rows a pending entry stands in for: an edit shows its new version,
 * a withdrawal shows nothing, until a snapshot catches up.
 */
let overriddenIds: ReadonlySet<string> = new Set();
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
let editLinks: readonly StoredEditLink[] = readEditLinks(storage);

function setEditLinks(next: readonly StoredEditLink[]): void {
  editLinks = next;
  minePanel.setLinks(next);
  mineToggle.hidden = next.length === 0;
  if (next.length === 0 && minePanel.isOpen()) {
    openOnly(null);
  }
}

/**
 * Read before anything else can copy the address: the token is saved here
 * and removed from the bar, leaving the ordinary report permalink behind.
 */
const initialEdit: EditLink | null = parseEditLink(window.location.search);
if (initialEdit !== null) {
  editLinks = saveEditLink(storage, initialEdit, {}, new Date());
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${withoutEditToken(window.location.search)}${window.location.hash}`,
  );
}
setEditLinks(editLinks);

/** The record shown for an id: a local version first, then the snapshot's. */
function findReport(id: string): ReportRecord | undefined {
  return pendingById.get(id) ?? (overriddenIds.has(id) ? undefined : reportsById.get(id));
}

/** Only one overlay panel is open at a time; on a phone they fill the screen. */
function openOnly(panel: 'filters' | 'info' | 'mine' | null): void {
  filterPanel?.setOpen(panel === 'filters');
  infoPanel.setOpen(panel === 'info');
  minePanel.setOpen(panel === 'mine');
  filtersToggle.setAttribute('aria-expanded', String(panel === 'filters'));
  infoToggle.setAttribute('aria-expanded', String(panel === 'info'));
  mineToggle.setAttribute('aria-expanded', String(panel === 'mine'));
}

/**
 * The permalinked report when the filter has dropped it, as a one element
 * list to add back. Empty whenever no permalink is open or the filter is
 * already showing it.
 */
function pinnedReport(visible: readonly ReportRecord[]): readonly ReportRecord[] {
  if (pinnedReportId === null) {
    return [];
  }
  const report = findReport(pinnedReportId);
  if (report === undefined || report.pending === true || visible.includes(report)) {
    return [];
  }
  return [report];
}

function refresh(state: FilterState): void {
  // Every pending entry left after pruning is newer than the snapshot row
  // with its id, if there is one, so that row is set aside.
  overriddenIds = new Set(pendingReports.map((entry) => entry.id));
  const base =
    overriddenIds.size === 0 ? reports : reports.filter((report) => !overriddenIds.has(report.id));
  const visible = applyFilters(base, state);
  // Pending points are added after filtering, never through it: someone who
  // has just submitted must see their own point even when the active filter
  // would exclude it. The summary still counts the snapshot alone.
  const extra = pendingReports.filter((entry) => !entry.withdrawn).map(toReportRecord);
  pendingById.clear();
  for (const entry of extra) {
    pendingById.set(entry.id, entry);
  }
  const pinned = pinnedReport(visible);
  mapController?.setReports([...visible, ...extra, ...pinned]);
  // The nearby notice is about what has been reported here, not about what
  // the active filter happens to show, so it reads the whole set.
  reportForm?.setReports([...base, ...extra]);
  filterPanel?.setSummary(visible.length, reports.length, trees.length);
}

filtersToggle.addEventListener('click', () => {
  openOnly(filterPanel?.isOpen() === true ? null : 'filters');
});

infoToggle.addEventListener('click', () => {
  openOnly(infoPanel.isOpen() ? null : 'info');
});

mineToggle.addEventListener('click', () => {
  openOnly(minePanel.isOpen() ? null : 'mine');
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

/** The map's own locate control, available without opening the report sheet. */
function runMapLocate(): void {
  locateMapButton.disabled = true;
  locateMapButton.textContent = strings.map.locating;
  locate()
    .then(() => {
      statusBar.hide();
    })
    .catch(() => {
      // A refusal is not a page level failure, but the button is too small
      // to explain itself, so the bar carries the sentence and the retry.
      statusBar.showError(strings.map.locateFailed, runMapLocate);
    })
    .finally(() => {
      locateMapButton.disabled = false;
      locateMapButton.textContent = strings.map.locate;
    });
}

locateMapButton.addEventListener('click', runMapLocate);

reportButton.addEventListener('click', () => {
  openOnly(null);
  detailCard.hide();
  reportForm?.startCreate();
  reportSheet.open();
});

/**
 * Open the form on a report this browser holds the link for.
 *
 * The fields come from the Worker rather than the snapshot, which can be a
 * quarter of an hour behind and may not carry a new report at all. A link the
 * Worker no longer honours is dropped from the list: nothing brings it back.
 */
async function beginEdit(link: EditLink): Promise<void> {
  const controller = mapController;
  const form = reportForm;
  if (controller === null || form === null) {
    return;
  }
  statusBar.showNotice(strings.status.editLoading);
  const outcome = await readEditableReport(link, (input, init) => fetch(input, init));

  if (outcome.kind === 'missing') {
    setEditLinks(removeEditLink(storage, link.id));
    statusBar.showNotice(strings.status.editMissing);
    return;
  }
  if (outcome.kind === 'network') {
    statusBar.showError(strings.status.editFailed, () => void beginEdit(link));
    return;
  }

  statusBar.hide();
  const { report } = outcome;
  const details = { lat: report.lat, lng: report.lng, species: report.species };
  setEditLinks(saveEditLink(storage, link, details, new Date()));
  openOnly(null);
  detailCard.hide();
  reportSheet.open();
  // The crosshair is the report's position, so it must land exactly on the
  // stored point; the reader moves it only if the point itself was wrong.
  controller.flyTo(
    { lat: report.lat, lng: report.lng },
    Math.max(controller.getZoom(), MIN_SUBMIT_ZOOM),
  );
  form.startEdit(link, report);
}

/** "Show on map" from the list, for a report that may not be in the snapshot yet. */
function showStoredReport(link: StoredEditLink): void {
  const report = findReport(link.id);
  if (report !== undefined) {
    focusOn(report.lat, report.lng);
    detailCard.showReport(report);
    return;
  }
  if (link.lat !== null && link.lng !== null) {
    focusOn(link.lat, link.lng);
  }
  statusBar.showNotice(strings.mine.notFound);
}

/**
 * The card a permalink asked for, opened once the data it needs has arrived.
 *
 * A target that cannot be found gets a notice rather than a redirect: the map
 * stays on its default view and the reader can carry on. The notice is held
 * back when the bar is already explaining a load failure, which is the more
 * useful of the two messages.
 */
const initialTarget = parsePermalink(window.location.search);
// An edit link opens the form instead, which focuses the report itself.
let initialTargetHandled = initialEdit !== null;

function openInitialTarget(quiet: boolean): void {
  if (initialTarget === null || initialTargetHandled) {
    return;
  }

  if (initialTarget.kind === 'report') {
    if (!snapshotLoaded) {
      return;
    }
    initialTargetHandled = true;
    const report = findReport(initialTarget.id);
    if (report === undefined) {
      if (quiet) {
        statusBar.showNotice(strings.status.reportMissing);
      }
      return;
    }
    pinnedReportId = report.id;
    refresh(filterPanel?.getState() ?? emptyFilterState());
    focusOn(report.lat, report.lng);
    detailCard.showReport(report);
    return;
  }

  if (!treesLoaded) {
    return;
  }
  initialTargetHandled = true;
  const tree = treesById.get(initialTarget.id);
  if (tree === undefined) {
    if (quiet) {
      statusBar.showNotice(strings.status.treeMissing);
    }
    return;
  }
  focusOn(tree.lat, tree.lng);
  detailCard.showTree(tree);
}

function focusOn(lat: number, lng: number): void {
  const controller = mapController;
  if (controller === null) {
    return;
  }
  controller.flyTo({ lat, lng }, Math.max(controller.getZoom(), PERMALINK_ZOOM));
}

let snapshotLoaded = false;
let treesLoaded = false;

async function load(): Promise<void> {
  statusBar.showLoading();
  const result = await loadMapData();

  if (result.snapshot !== null) {
    snapshotLoaded = true;
    reports = result.snapshot.reports;
    reportsById.clear();
    for (const report of reports) {
      reportsById.set(report.id, report);
    }
    // Only a snapshot that actually loaded may retire a pending point.
    pendingReports = prunePending(
      storage,
      { ids: new Set(reportsById.keys()), generatedAt: result.snapshot.generatedAt },
      new Date(),
    );
  }

  if (result.trees !== null) {
    treesLoaded = true;
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
    openInitialTarget(false);
    return;
  }
  if (result.snapshotFailed) {
    statusBar.showError(strings.status.snapshotFailed, () => void load());
    openInitialTarget(false);
    return;
  }
  if (result.treesFailed) {
    statusBar.showError(strings.status.treesFailed, () => void load());
    openInitialTarget(false);
    return;
  }
  statusBar.hide();
  openInitialTarget(true);
}

async function start(): Promise<void> {
  statusBar.showLoading();

  const { createMapController } = await import('./map/index.ts');
  // CSS follows the device scheme through a media query; the map style cannot,
  // so the controller is told the scheme and then told again when it flips.
  const schemeWatcher = watchDeviceColorScheme(window);
  const controller = createMapController(required('#map'), schemeWatcher.current());
  schemeWatcher.subscribe((scheme) => {
    controller.setColorScheme(scheme);
  });
  mapController = controller;
  filterPanel = createFilterPanel(required('#filter-panel'), refresh);
  filterPanel.onOpenChange((open) => {
    filtersToggle.setAttribute('aria-expanded', String(open));
  });
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
    onDismiss() {
      reportSheet.close();
    },
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
    storage,
    onEditLink(link, entry) {
      const details = { lat: entry.lat, lng: entry.lng, species: entry.species };
      setEditLinks(saveEditLink(storage, link, details, new Date()));
    },
    onEditLinkGone(id) {
      setEditLinks(removeEditLink(storage, id));
    },
    onEditingChange(editing) {
      reportSheet.setEditing(editing);
    },
    editLinkUrl: (link) => editLinkUrl(link, window.location.href),
    share: shareUrl,
    confirm: (message) => window.confirm(message),
    // Matches the desktop breakpoint in style.css, where the sheet is a side
    // column and has room for the instructions.
    guideOpen: window.matchMedia('(min-width: 768px)').matches,
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
    const report = findReport(id);
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

  if (initialEdit !== null) {
    await beginEdit(initialEdit);
  }
}

void start();
