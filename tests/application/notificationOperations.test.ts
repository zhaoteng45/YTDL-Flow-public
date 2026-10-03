import { describe, expect, it } from 'vitest';
import { createNotificationOperations } from '../../src/application/notificationOperations';

describe('notification operations seam', () => {
  it('normalizes notification permission and hides native command names', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const operations = createNotificationOperations({
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === 'get_notification_settings') {
          return { enabled: true, onSuccess: true, onError: false, onCancel: true } as T;
        }
        return true as T;
      },
      isPermissionGranted: async () => false,
      requestPermission: async () => 'granted',
    });

    await expect(operations.getPermissionStatus()).resolves.toBe(false);
    await expect(operations.requestPermission()).resolves.toBe(true);
    await expect(operations.getSettings()).resolves.toEqual({
      enabled: true,
      onSuccess: true,
      onError: false,
      onCancel: true,
    });

    const settings = { enabled: true, onSuccess: false, onError: true, onCancel: false };
    await operations.updateSettings(settings);
    const i18n = {
      successTitle: 'ok',
      errorTitle: 'error',
      cancelTitle: 'cancel',
      batchSuccessTitle: 'batch ok',
      batchErrorTitle: 'batch error',
      batchCancelTitle: 'batch cancel',
      tasksCompleted: 'done',
      openFolder: 'folder',
    };
    await operations.initI18n(i18n);

    expect(calls).toEqual([
      { command: 'get_notification_settings', args: undefined },
      { command: 'update_notification_settings', args: { settings } },
      { command: 'init_notification_i18n', args: { i18n } },
    ]);
  });

  it('returns false when native permission request is denied', async () => {
    const operations = createNotificationOperations({
      invoke: async <T>() => true as T,
      isPermissionGranted: async () => false,
      requestPermission: async () => 'denied',
    });

    await expect(operations.requestPermission()).resolves.toBe(false);
  });
});
