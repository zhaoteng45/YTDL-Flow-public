import type { NativeInvoker } from './toolchainOperations';

export type BrowserCookieCheckKind =
  | 'ok'
  | 'invalid_browser'
  | 'locked'
  | 'permission_denied'
  | 'not_found'
  | 'decrypt_failed'
  | 'execution_failed';

export interface BrowserCookieCheck {
  success: boolean;
  kind: BrowserCookieCheckKind;
  message: string;
  details?: string | null;
}

export interface CookieFileInspection {
  state: 'imported' | 'invalid' | 'expired' | 'mismatch';
  total: number;
  matching: number;
  fresh: number;
}

export interface BilibiliQrCode {
  url: string;
  qrcode_key: string;
}

export interface BilibiliPollResult {
  status: string;
  message: string;
  cookies: string | null;
}

export interface BilibiliUserInfo {
  uname: string;
  face: string;
  is_login: boolean;
}

export interface CredentialOperations {
  inspectCookieFile(path: string, url?: string): Promise<CookieFileInspection>;
  getInstalledBrowsers(): Promise<string[]>;
  checkBrowserCookies(browser: string): Promise<BrowserCookieCheck>;
  getBilibiliQrCode(): Promise<BilibiliQrCode>;
  pollBilibiliQrCode(qrcodeKey: string): Promise<BilibiliPollResult>;
  saveBilibiliCookies(cookieStr: string): Promise<string>;
  getBilibiliUserInfo(cookieStr: string): Promise<BilibiliUserInfo>;
}

export function createCredentialOperations(invoke: NativeInvoker): CredentialOperations {
  return {
    inspectCookieFile: (path, url) => invoke<CookieFileInspection>('inspect_cookie_file', { path, url }),
    getInstalledBrowsers: () => invoke<string[]>('get_installed_browsers'),
    checkBrowserCookies: (browser) =>
      invoke<BrowserCookieCheck>('check_browser_cookies', { browser }),
    getBilibiliQrCode: () => invoke<BilibiliQrCode>('get_bilibili_qrcode'),
    pollBilibiliQrCode: (qrcodeKey) =>
      invoke<BilibiliPollResult>('poll_bilibili_qrcode', { qrcodeKey }),
    saveBilibiliCookies: (cookieStr) =>
      invoke<string>('save_bilibili_cookies', { cookieStr }),
    getBilibiliUserInfo: (cookieStr) =>
      invoke<BilibiliUserInfo>('get_bilibili_user_info', { cookieStr }),
  };
}
