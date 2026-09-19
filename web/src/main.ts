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

import type { ReportRecord } from './data/snapshot.ts';
import type { ProtectedTree } from './data/trees.ts';
import { loadMapData } from './data/load.ts';
import type { FilterState } from './filters.ts';
import { applyFilters, emptyFilterState } from './filters.ts';
import type { MapController } from './map/index.ts';
import strings from './ui-strings.json';
import { createDetailCard } from './ui/detail-card.ts';
import type { FilterPanel } from './ui/filter-panel.ts';
import { createFilterPanel } from './ui/filter-panel.ts';
import { createInfoPanel } from './ui/info-panel.ts';
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

let reports: readonly ReportRecord[] = [];
let trees: readonly ProtectedTree[] = [];
const reportsById = new Map<string, ReportRecord>();
const treesById = new Map<string, ProtectedTree>();

/** Only one overlay panel is open at a time; on a phone they fill the screen. */
function openOnly(panel: 'filters' | 'info' | null): void {
  filterPanel?.setOpen(panel === 'filters');
  infoPanel.setOpen(panel === 'info');
  filtersToggle.setAttribute('aria-expanded', String(panel === 'filters'));
  infoToggle.setAttribute('aria-expanded', String(panel === 'info'));
}

function refresh(state: FilterState): void {
  const visible = applyFilters(reports, state);
  mapController?.setReports(visible);
  filterPanel?.setSummary(visible.length, reports.length, trees.length);
}

filtersToggle.addEventListener('click', () => {
  openOnly(filterPanel?.isOpen() === true ? null : 'filters');
});

infoToggle.addEventListener('click', () => {
  openOnly(infoPanel.isOpen() ? null : 'info');
});

orthoToggle.addEventListener('click', () => {
  const next = orthoToggle.getAttribute('aria-pressed') !== 'true';
  mapController?.setOrthoVisible(next);
  orthoToggle.setAttribute('aria-pressed', String(next));
});

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
  }

  if (result.trees !== null) {
    trees = result.trees.trees;
    treesById.clear();
    for (const tree of trees) {
      treesById.set(tree.id, tree);
    }
    mapController?.setTrees(trees);
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
  mapController = createMapController(required('#map'));
  filterPanel = createFilterPanel(required('#filter-panel'), refresh);

  mapController.onReportClick((id) => {
    const report = reportsById.get(id);
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
