import { describe, expect, it } from 'vitest';
import { getDownloadRecovery } from '../../src/application/downloadRecovery';

describe('download recovery', () => {
  it.each([
    ['SMART_DECISION_REQUIRED: analyze first', 'reanalyze', 'decision'],
    ['Requested format is not available', 'reanalyze', 'format'],
    ['Sign in to confirm your age', 'credentials', 'authentication'],
    ['account cookies are no longer valid', 'credentials', 'authentication'],
    ['failed to decrypt with DPAPI', 'credentials', 'cookieDecrypt'],
    ['Could not copy Chrome cookie database', 'credentials', 'cookieLocked'],
    ['No space left on device', 'directory', 'disk'],
    ['Permission denied', 'directory', 'permission'],
    ['HTTP Error 429: Too Many Requests', 'wait', 'rateLimit'],
    ['Connection reset by peer', 'retry', 'network'],
    ['HTTP Error 403: Forbidden', 'reanalyze', 'blocked'],
    ['Postprocessing: conversion failed!', 'format', 'processing'],
    ['This video is DRM protected', 'none', 'protected'],
    ['unknown failure', 'retry', 'unknown'],
  ])('maps %s to a useful recovery operation', (error, action, kind) => {
    expect(getDownloadRecovery(error)).toMatchObject({ action, kind });
  });
  it('does not invent failures when no error exists', () => {
    expect(getDownloadRecovery(undefined)).toBeUndefined();
  });
});
