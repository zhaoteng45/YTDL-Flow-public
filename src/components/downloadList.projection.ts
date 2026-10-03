import type { TaskPresentationRow, TaskPresentationStatus } from '../application/taskPresentation';
import type { DownloadFormat } from '../types';

export type DownloadListStatusFilter = 'all' | 'active' | 'waiting' | 'failed' | 'completed';

export type RowFormatSelections = Readonly<Partial<Record<string, DownloadFormat>>>;

export interface DownloadListViewInput {
  searchQuery?: string;
  statusFilter?: DownloadListStatusFilter;
  pendingRemovalRowIds?: Readonly<Record<string, boolean>>;
  rowFormatSelections?: RowFormatSelections;
}

export interface QueueSummary {
  total: number;
  active: number;
  waiting: number;
  failed: number;
  completed: number;
  concurrencyUsed: number;
}

export interface DownloadListProjection {
  readonly visibleRows: readonly TaskPresentationRow[];
  readonly summary: Readonly<QueueSummary>;
  readonly queuePositions: ReadonlyMap<string, number>;
}

const ACTIVE_STATUSES: ReadonlySet<TaskPresentationStatus> = new Set([
  'analyzing',
  'pending',
  'downloading',
  'processing',
]);
const CONCURRENCY_STATUSES: ReadonlySet<TaskPresentationStatus> = new Set([
  'pending',
  'downloading',
  'processing',
]);

/**
 * Effective format for a row: the local per-row selection wins, then the
 * format saved on the row, then the video default.
 */
export const resolveRowFormat = (
  row: TaskPresentationRow,
  selections: RowFormatSelections = {},
): DownloadFormat => selections[row.rowId] ?? row.selectedFormat ?? 'video';

const matchesSearch = (
  row: TaskPresentationRow,
  query: string,
  rowFormatSelections: RowFormatSelections,
): boolean => {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const title = (row.metadata?.title || row.title || '').toLowerCase();
  const url = (row.url || '').toLowerCase();
  const channel = (
    row.metadata?.channel ||
    (row.metadata as unknown as { uploader?: string } | undefined)?.uploader ||
    ''
  ).toLowerCase();
  const format = resolveRowFormat(row, rowFormatSelections).toLowerCase();
  const rowId = (row.rowId || '').toLowerCase();
  return (
    title.includes(q) ||
    url.includes(q) ||
    channel.includes(q) ||
    format.includes(q) ||
    rowId.includes(q)
  );
};

/**
 * Pure presentation projection for the download list. It owns the visible-row
 * policy (search + display grouping + status filter) while keeping FIFO queue
 * positions anchored to the complete input snapshot.
 */
export function projectDownloadList(
  items: readonly TaskPresentationRow[],
  view: DownloadListViewInput = {},
): DownloadListProjection {
  const {
    searchQuery = '',
    statusFilter = 'all',
    pendingRemovalRowIds = {},
    rowFormatSelections = {},
  } = view;

  const unremoved = items.filter((item) => !pendingRemovalRowIds[item.rowId]);

  const summary: QueueSummary = {
    total: 0,
    active: 0,
    waiting: 0,
    failed: 0,
    completed: 0,
    concurrencyUsed: 0,
  };
  const activeRows: TaskPresentationRow[] = [];
  const queuedRows: TaskPresentationRow[] = [];
  const analyzedRows: TaskPresentationRow[] = [];
  const failedRows: TaskPresentationRow[] = [];
  const completedRows: TaskPresentationRow[] = [];

  for (const row of unremoved) {
    summary.total++;
    if (ACTIVE_STATUSES.has(row.status)) {
      summary.active++;
    } else if (row.status === 'queued' || row.status === 'analyzed') {
      summary.waiting++;
    } else if (row.status === 'error') {
      summary.failed++;
    } else if (row.status === 'completed') {
      summary.completed++;
    }
    if (CONCURRENCY_STATUSES.has(row.status)) summary.concurrencyUsed++;

    if (!matchesSearch(row, searchQuery, rowFormatSelections)) continue;

    if (ACTIVE_STATUSES.has(row.status)) {
      activeRows.push(row);
    } else if (row.status === 'queued') {
      queuedRows.push(row);
    } else if (row.status === 'analyzed') {
      analyzedRows.push(row);
    } else if (row.status === 'error') {
      failedRows.push(row);
    } else if (row.status === 'completed') {
      completedRows.push(row);
    }
  }

  queuedRows.sort((a, b) => (a.queuedAt ?? a.orderKey ?? 0) - (b.queuedAt ?? b.orderKey ?? 0));
  analyzedRows.sort((a, b) => (b.updatedAt ?? b.orderKey ?? 0) - (a.updatedAt ?? a.orderKey ?? 0));
  activeRows.sort((a, b) => (b.updatedAt ?? b.orderKey ?? 0) - (a.updatedAt ?? a.orderKey ?? 0));
  failedRows.sort((a, b) => (b.lastTerminalAt ?? b.orderKey ?? 0) - (a.lastTerminalAt ?? a.orderKey ?? 0));
  completedRows.sort((a, b) => (b.lastTerminalAt ?? b.orderKey ?? 0) - (a.lastTerminalAt ?? a.orderKey ?? 0));

  const fullQueued = items
    .filter((item) => item.status === 'queued')
    .sort((a, b) => (a.queuedAt ?? a.orderKey ?? 0) - (b.queuedAt ?? b.orderKey ?? 0));
  const queuePositions = new Map(fullQueued.map((row, index) => [row.rowId, index + 1]));

  let visibleRows: TaskPresentationRow[];
  switch (statusFilter) {
    case 'active':
      visibleRows = [...activeRows];
      break;
    case 'waiting':
      visibleRows = [...queuedRows, ...analyzedRows];
      break;
    case 'failed':
      visibleRows = [...failedRows];
      break;
    case 'completed':
      visibleRows = [...completedRows];
      break;
    default:
      visibleRows = [...activeRows, ...queuedRows, ...analyzedRows, ...failedRows, ...completedRows];
  }

  return { visibleRows, summary, queuePositions };
}
