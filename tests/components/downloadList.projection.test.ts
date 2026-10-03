import { describe, expect, it } from 'vitest';

import { resolveCurrentTaskActions } from '../../packages/application/src/current-task-projection';
import type { CurrentAnalysisMedia, CurrentTaskRow } from '../../packages/contracts/src';
import {
  toCurrentTaskPresentationRow,
  type TaskPresentationRow,
} from '../../src/application/taskPresentation';
import {
  projectDownloadList,
  resolveRowFormat,
  type DownloadListStatusFilter,
} from '../../src/components/downloadList.projection';

/**
 * Builds the same row shape the UI receives in production:
 * a CurrentTaskRow projected through the presentation adapter, with the
 * service-owned action projection attached.
 */
function makeRow(overrides: Partial<CurrentTaskRow> = {}): TaskPresentationRow {
  const status = overrides.status ?? 'queued';
  const row: CurrentTaskRow = {
    rowId: overrides.rowId ?? `row-${Math.random().toString(36).slice(2, 9)}`,
    attemptId: overrides.attemptId ?? `attempt-${Math.random().toString(36).slice(2, 9)}`,
    sourceUrl: overrides.sourceUrl ?? 'https://example.test/video',
    status,
    orderKey: overrides.orderKey ?? 0,
    metadata: overrides.metadata,
    progress: overrides.progress ?? 0,
    logs: [],
    cancelRequested: false,
    actions: resolveCurrentTaskActions({ status, failureKind: overrides.failureKind }),
    ...overrides,
  };
  return toCurrentTaskPresentationRow(row);
}

const media = (title: string) => ({
  title,
  thumbnail: '',
  duration: '',
  channel: '',
  url: `https://example.test/${title}`,
});

describe('projectDownloadList', () => {
  it('keeps full-snapshot FIFO positions while pending removal and search shape summary and visible rows', () => {
    const items = [
      makeRow({ rowId: 'q1', status: 'queued', orderKey: 10, metadata: media('alpha') }),
      makeRow({ rowId: 'q2', status: 'queued', orderKey: 20, metadata: media('bravo') }),
      makeRow({ rowId: 'q3', status: 'queued', orderKey: 30, metadata: media('charlie') }),
    ];

    const projection = projectDownloadList(items, {
      pendingRemovalRowIds: { q1: true },
      searchQuery: 'charlie',
      statusFilter: 'waiting',
    });

    expect(projection.visibleRows.map((row) => row.rowId)).toEqual(['q3']);
    expect(projection.summary.total).toBe(2);
    expect(projection.summary.waiting).toBe(2);
    expect([...projection.queuePositions]).toEqual([
      ['q1', 1],
      ['q2', 2],
      ['q3', 3],
    ]);
    expect(projection.queuePositions.get('q3')).toBe(3);
  });

  it('keeps summary independent of search and status filter while pending removal still counts', () => {
    const items = [
      makeRow({ rowId: 'run', status: 'downloading', orderKey: 1 }),
      makeRow({ rowId: 'q1', status: 'queued', orderKey: 2 }),
      makeRow({ rowId: 'q2', status: 'queued', orderKey: 3 }),
      makeRow({ rowId: 'bad', status: 'error', failureKind: 'unknown', orderKey: 4 }),
      makeRow({ rowId: 'done', status: 'completed', orderKey: 5 }),
    ];

    const projection = projectDownloadList(items, {
      searchQuery: 'no-such-row',
      statusFilter: 'failed',
      pendingRemovalRowIds: { run: true },
    });

    expect(projection.visibleRows).toEqual([]);
    expect(projection.summary).toEqual({
      total: 4,
      active: 0,
      waiting: 2,
      failed: 1,
      completed: 1,
      concurrencyUsed: 0,
    });
  });

  it('classifies every summary status without counting analyzing against concurrency', () => {
    const projection = projectDownloadList([
      makeRow({ status: 'analyzing' }),
      makeRow({ status: 'pending' }),
      makeRow({ status: 'downloading' }),
      makeRow({ status: 'processing' }),
      makeRow({ status: 'queued' }),
      makeRow({ status: 'analyzed' }),
      makeRow({ status: 'error', failureKind: 'unknown' }),
      makeRow({ status: 'completed' }),
    ]);

    expect(projection.summary).toEqual({
      total: 8,
      active: 4,
      waiting: 2,
      failed: 1,
      completed: 1,
      concurrencyUsed: 3,
    });
  });

  it('hides pending-removal rows from the default visible list', () => {
    const items = [
      makeRow({ rowId: 'q1', status: 'queued', orderKey: 1 }),
      makeRow({ rowId: 'q2', status: 'queued', orderKey: 2 }),
    ];

    const projection = projectDownloadList(items, {
      pendingRemovalRowIds: { q1: true },
    });

    expect(projection.visibleRows.map((row) => row.rowId)).toEqual(['q2']);
  });

  it('resolves the effective row format: local selection, then row selection, then video', () => {
    const plain = makeRow({ rowId: 'plain', status: 'analyzed' });

    expect(resolveRowFormat(plain)).toBe('video');
    expect(resolveRowFormat(plain, {})).toBe('video');
    expect(resolveRowFormat(makeRow({ rowId: 'picked', status: 'analyzed', selectedFormat: 'mp3' }))).toBe('mp3');
    expect(resolveRowFormat(plain, { plain: 'flac' })).toBe('flac');
  });

  it('searches title, url, channel, legacy uploader, effective format and rowId', () => {
    const items = [
      makeRow({
        rowId: 'title-row',
        status: 'analyzed',
        sourceUrl: 'https://example.test/title-route',
        metadata: media('Unique Title Hit'),
      }),
      makeRow({
        rowId: 'url-row',
        status: 'analyzed',
        sourceUrl: 'https://example.test/unique-url-hit',
        metadata: media('plain-title'),
      }),
      makeRow({
        rowId: 'channel-row',
        status: 'analyzed',
        sourceUrl: 'https://example.test/channel-route',
        metadata: { ...media('plain-title'), channel: 'Unique Channel Hit' },
      }),
      makeRow({
        rowId: 'legacy-row',
        status: 'analyzed',
        sourceUrl: 'https://example.test/legacy-route',
        metadata: {
          ...media('plain-title'),
          uploader: 'Legacy Uploader Hit',
        } as unknown as CurrentAnalysisMedia,
      }),
      makeRow({
        rowId: 'format-row',
        status: 'analyzed',
        sourceUrl: 'https://example.test/format-route',
        selectedFormat: 'mp3',
        metadata: media('plain-title'),
      }),
      makeRow({
        rowId: 'video-row',
        status: 'analyzed',
        sourceUrl: 'https://example.test/video-route',
        metadata: media('plain-title'),
      }),
    ];

    const search = (query: string, rowFormatSelections?: Record<string, 'flac'>) =>
      projectDownloadList(items, { searchQuery: query, rowFormatSelections })
        .visibleRows.map((row) => row.rowId);

    expect(search('  Unique Title Hit  ')).toEqual(['title-row']);
    expect(search('unique-url-hit')).toEqual(['url-row']);
    expect(search('unique channel hit')).toEqual(['channel-row']);
    expect(search('legacy uploader hit')).toEqual(['legacy-row']);
    expect(search('title-row')).toEqual(['title-row']);

    expect(search('mp3')).toEqual(['format-row']);
    expect(search('flac', { 'format-row': 'flac' })).toEqual(['format-row']);
    expect(search('mp3', { 'format-row': 'flac' })).toEqual([]);
    expect(search('video')).toContain('video-row');
    expect(search('video')).not.toContain('format-row');
    expect(search('mp4')).toEqual([]);
  });

  it('keeps the approved per-status ordering and flattened group order', () => {
    const items = [
      makeRow({ rowId: 'q2', status: 'queued', orderKey: 20 }),
      makeRow({ rowId: 'a2', status: 'downloading', orderKey: 2 }),
      makeRow({ rowId: 'an1', status: 'analyzed', orderKey: 10 }),
      makeRow({ rowId: 'f1', status: 'error', failureKind: 'unknown', orderKey: 5 }),
      makeRow({ rowId: 'c1', status: 'completed', orderKey: 7 }),
      makeRow({ rowId: 'q1', status: 'queued', orderKey: 10 }),
      makeRow({ rowId: 'a1', status: 'analyzing', orderKey: 3 }),
      makeRow({ rowId: 'an2', status: 'analyzed', orderKey: 30 }),
      makeRow({ rowId: 'f2', status: 'error', failureKind: 'unknown', orderKey: 9 }),
      makeRow({ rowId: 'c2', status: 'completed', orderKey: 2 }),
    ];

    expect(projectDownloadList(items).visibleRows.map((row) => row.rowId)).toEqual([
      'a1',
      'a2',
      'q1',
      'q2',
      'an2',
      'an1',
      'f2',
      'f1',
      'c1',
      'c2',
    ]);
  });

  it('prefers the phase timestamp over orderKey when ordering waiting and terminal groups', () => {
    const withTimestamps = (
      row: TaskPresentationRow,
      timestamps: Partial<TaskPresentationRow>,
    ): TaskPresentationRow => ({ ...row, ...timestamps });

    const items = [
      withTimestamps(makeRow({ rowId: 'q-order-first', status: 'queued', orderKey: 10 }), { queuedAt: 300 }),
      withTimestamps(makeRow({ rowId: 'q-time-first', status: 'queued', orderKey: 20 }), { queuedAt: 100 }),
      withTimestamps(makeRow({ rowId: 'an-order-first', status: 'analyzed', orderKey: 10 }), { updatedAt: 100 }),
      withTimestamps(makeRow({ rowId: 'an-time-first', status: 'analyzed', orderKey: 20 }), { updatedAt: 300 }),
      withTimestamps(makeRow({ rowId: 'f-order-first', status: 'error', failureKind: 'unknown', orderKey: 10 }), { lastTerminalAt: 100 }),
      withTimestamps(makeRow({ rowId: 'f-time-first', status: 'error', failureKind: 'unknown', orderKey: 20 }), { lastTerminalAt: 300 }),
      withTimestamps(makeRow({ rowId: 'c-order-first', status: 'completed', orderKey: 10 }), { lastTerminalAt: 100 }),
      withTimestamps(makeRow({ rowId: 'c-time-first', status: 'completed', orderKey: 20 }), { lastTerminalAt: 300 }),
    ];

    expect(projectDownloadList(items).visibleRows.map((row) => row.rowId)).toEqual([
      'q-time-first',
      'q-order-first',
      'an-time-first',
      'an-order-first',
      'f-time-first',
      'f-order-first',
      'c-time-first',
      'c-order-first',
    ]);
    expect([...projectDownloadList(items).queuePositions]).toEqual([
      ['q-time-first', 1],
      ['q-order-first', 2],
    ]);
  });

  it('selects the approved status filter groups without renumbering queue positions', () => {
    const items = [
      makeRow({ rowId: 'run', status: 'downloading', orderKey: 1 }),
      makeRow({ rowId: 'q1', status: 'queued', orderKey: 2 }),
      makeRow({ rowId: 'q2', status: 'queued', orderKey: 3 }),
      makeRow({ rowId: 'ready', status: 'analyzed', orderKey: 4 }),
      makeRow({ rowId: 'bad', status: 'error', failureKind: 'unknown', orderKey: 5 }),
      makeRow({ rowId: 'done', status: 'completed', orderKey: 6 }),
    ];
    const ids = (statusFilter: DownloadListStatusFilter) =>
      projectDownloadList(items, { statusFilter }).visibleRows.map((row) => row.rowId);

    expect(ids('all')).toEqual(['run', 'q1', 'q2', 'ready', 'bad', 'done']);
    expect(ids('active')).toEqual(['run']);
    expect(ids('waiting')).toEqual(['q1', 'q2', 'ready']);
    expect(ids('failed')).toEqual(['bad']);
    expect(ids('completed')).toEqual(['done']);

    const waiting = projectDownloadList(items, { statusFilter: 'waiting' });
    expect(waiting.queuePositions.get('q2')).toBe(2);
    expect([...waiting.queuePositions.keys()]).toEqual(['q1', 'q2']);
  });

  it('does not mutate the input snapshot and preserves row identity in the projection', () => {
    const q2 = makeRow({ rowId: 'q2', status: 'queued', orderKey: 20 });
    const q1 = makeRow({ rowId: 'q1', status: 'queued', orderKey: 10 });
    const items = [q2, q1];
    const snapshot = [...items];

    const projection = projectDownloadList(items, { searchQuery: 'q' });

    expect(items).toEqual(snapshot);
    expect(projection.visibleRows).toEqual([q1, q2]);
    expect(projection.visibleRows[0]).toBe(q1);
    expect(projection.visibleRows[1]).toBe(q2);
  });

  it('returns an empty projection for empty input', () => {
    const projection = projectDownloadList([]);

    expect(projection.visibleRows).toEqual([]);
    expect(projection.summary).toEqual({
      total: 0,
      active: 0,
      waiting: 0,
      failed: 0,
      completed: 0,
      concurrencyUsed: 0,
    });
    expect([...projection.queuePositions]).toEqual([]);
  });
});
