import type { NativeInvoker } from './toolchainOperations';

export interface NotificationSettings {
  enabled: boolean;
  onSuccess: boolean;
  onError: boolean;
  onCancel: boolean;
}

export interface NotificationI18n {
  successTitle: string;
  errorTitle: string;
  cancelTitle: string;
  batchSuccessTitle: string;
  batchErrorTitle: string;
  batchCancelTitle: string;
  tasksCompleted: string;
  openFolder: string;
}

interface NotificationDependencies {
  invoke: NativeInvoker;
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<string>;
}

export interface NotificationOperations {
  getPermissionStatus(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  getSettings(): Promise<NotificationSettings>;
  updateSettings(settings: NotificationSettings): Promise<unknown>;
  initI18n(i18n: NotificationI18n): Promise<unknown>;
}

export function createNotificationOperations(
  deps: NotificationDependencies,
): NotificationOperations {
  return {
    getPermissionStatus: () => deps.isPermissionGranted(),
    requestPermission: async () => (await deps.requestPermission()) === 'granted',
    getSettings: () => deps.invoke<NotificationSettings>('get_notification_settings'),
    updateSettings: (settings) =>
      deps.invoke('update_notification_settings', { settings }),
    initI18n: (i18n) =>
      deps.invoke('init_notification_i18n', { i18n }),
  };
}
