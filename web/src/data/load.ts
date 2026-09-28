/**
 * Fetch the datasets in parallel and decode them.
 *
 * The sources fail independently: a broken snapshot must still leave the
 * protected tree layer on screen, and the other way round. The caller decides
 * what to tell the reader, so failures come back as values rather than
 * rejections.
 */
import type { RemovalPlanIndex } from './removal-plans.ts';
import { decodeRemovalPlans } from './removal-plans.ts';
import type { DecodedSnapshot } from './snapshot.ts';
import { decodeSnapshot } from './snapshot.ts';
import type { DecodedTrees } from './trees.ts';
import { decodeTrees } from './trees.ts';

export const SNAPSHOT_URL = '/api/snapshot';
export const TREES_URL = '/trees.json';
export const REMOVAL_PLANS_URL = '/removal-plans.json';

export interface LoadResult {
  readonly snapshot: DecodedSnapshot | null;
  readonly trees: DecodedTrees | null;
  /**
   * Null when the file failed; the plan trees still show, only their cards
   * cannot name the plan, so the reader is not told about it.
   */
  readonly removalPlans: RemovalPlanIndex | null;
  readonly snapshotFailed: boolean;
  readonly treesFailed: boolean;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${String(response.status)}`);
  }
  return response.json();
}

async function loadOne<T>(url: string, decode: (payload: unknown) => T): Promise<T | null> {
  try {
    return decode(await fetchJson(url));
  } catch (error) {
    console.error(`failed to load ${url}`, error);
    return null;
  }
}

export async function loadMapData(): Promise<LoadResult> {
  const [snapshot, trees, removalPlans] = await Promise.all([
    loadOne(SNAPSHOT_URL, decodeSnapshot),
    loadOne(TREES_URL, decodeTrees),
    loadOne(REMOVAL_PLANS_URL, decodeRemovalPlans),
  ]);

  return {
    snapshot,
    trees,
    removalPlans,
    snapshotFailed: snapshot === null,
    treesFailed: trees === null,
  };
}
