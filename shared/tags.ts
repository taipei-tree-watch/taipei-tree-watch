/**
 * Single source of truth for every tag dimension and for the data-source column.
 *
 * Each entry has an integer `code` that is never reused, reordered or recycled,
 * a stable English `slug`, and the Chinese `label` shown in the UI.
 * New entries are appended only. Stored data references entries by `code`.
 */

export interface Tag {
  readonly code: number;
  readonly slug: string;
  readonly label: string;
}

/** Cause of removal or treatment, as written on the notice or official document. Multi-select. */
export const causes = [
  { code: 1, slug: 'brown-root-rot', label: '褐根病' },
  { code: 2, slug: 'pest-disease-other', label: '病蟲害（褐根病以外）' },
  { code: 3, slug: 'decay-cavity', label: '腐朽／樹洞' },
  { code: 4, slug: 'dead', label: '枯死／自然死亡' },
  { code: 5, slug: 'fall-risk', label: '傾倒風險／公共安全' },
  { code: 6, slug: 'risk-assessment-high', label: '風險評估高風險' },
  { code: 7, slug: 'root-heave', label: '竄根／破壞路面' },
  { code: 8, slug: 'vehicle-damage', label: '車輛撞損' },
  { code: 9, slug: 'unknown', label: '不明' },
  { code: 20, slug: 'mrt-construction', label: '捷運工程' },
  { code: 21, slug: 'road-construction', label: '道路工程' },
  { code: 22, slug: 'building-construction', label: '建築工程' },
  { code: 23, slug: 'park-school-works', label: '公園整建／校舍工程' },
  { code: 24, slug: 'typhoon', label: '防颱修剪／颱風倒伏' },
] as const satisfies readonly Tag[];

/** What was observed at the site after the work. Multi-select. */
export const dispositions = [
  { code: 1, slug: 'pruned-only', label: '僅修枝葉' },
  { code: 2, slug: 'trunk-only', label: '僅剩主幹' },
  { code: 3, slug: 'roots-only', label: '僅剩根部' },
  { code: 4, slug: 'removed-with-roots', label: '連根移除' },
  { code: 5, slug: 'transplanted', label: '已移植' },
  { code: 6, slug: 'pit-filled-concrete', label: '樹穴填平' },
  { code: 7, slug: 'retained-in-place', label: '原地保留' },
] as const satisfies readonly Tag[];

/** What the reporter relied on when filling in causes. Single-select. */
export const evidence = [
  { code: 1, slug: 'site-notice-photographed', label: '現場公告（有拍到照片）' },
  { code: 2, slug: 'site-notice-not-photographed', label: '現場公告（沒拍到）' },
  { code: 3, slug: 'official-document', label: '機關官網公告或計畫書' },
  { code: 4, slug: 'news-report', label: '新聞報導' },
  { code: 5, slug: 'high-risk-tag', label: '高風險掛牌（尚未移除）' },
  { code: 6, slug: 'sighting-only', label: '無公告，僅目擊' },
] as const satisfies readonly Tag[];

/** Who produced the report. Set by the server or an import job, never by the user. Single-select. */
export const sources = [
  { code: 1, slug: 'user-report', label: '使用者回報' },
  { code: 2, slug: 'delisting-record', label: '樹保會解除列管紀錄' },
  { code: 3, slug: 'removal-plan', label: '公園處移除計畫書' },
  { code: 4, slug: 'inventory-disappearance', label: '清冊消失偵測' },
] as const satisfies readonly Tag[];

export type Cause = (typeof causes)[number];
export type CauseCode = Cause['code'];
export type CauseSlug = Cause['slug'];

export type Disposition = (typeof dispositions)[number];
export type DispositionCode = Disposition['code'];
export type DispositionSlug = Disposition['slug'];

export type Evidence = (typeof evidence)[number];
export type EvidenceCode = Evidence['code'];
export type EvidenceSlug = Evidence['slug'];

export type Source = (typeof sources)[number];
export type SourceCode = Source['code'];
export type SourceSlug = Source['slug'];

/** Default evidence for a new report: no notice was present, the reporter only saw the site. */
export const DEFAULT_EVIDENCE_CODE = 6 satisfies EvidenceCode;

/** Every report created through the public API carries this source; the server enforces it. */
export const USER_REPORT_SOURCE_CODE = 1 satisfies SourceCode;

/** Evidence codes under which causes must stay empty: nothing on site states a cause. */
export const EVIDENCE_CODES_WITHOUT_CAUSES = [5, 6] as const satisfies readonly EvidenceCode[];

export const tags = {
  causes,
  dispositions,
  evidence,
  sources,
} as const;

export type TagDimension = keyof typeof tags;
