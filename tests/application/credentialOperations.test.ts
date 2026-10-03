import { describe, expect, it } from 'vitest';
import { createCredentialOperations } from '../../src/application/credentialOperations';

describe('credential operations seam', () => {
  it('hides browser and Bilibili command names while preserving typed results', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const responses: Record<string, unknown> = {
      get_installed_browsers: ['chrome', 'edge'],
      check_browser_cookies: { success: true, message: 'ok' },
      get_bilibili_qrcode: { url: 'https://example.invalid/qr', qrcode_key: 'qr-key' },
      poll_bilibili_qrcode: { status: 'success', message: 'ok', cookies: 'cookie-value' },
      save_bilibili_cookies: 'C:/tmp/bilibili_cookies.txt',
      get_bilibili_user_info: { uname: 'tester', face: 'https://example.invalid/avatar', is_login: true },
    };

    const operations = createCredentialOperations(async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return responses[command] as T;
    });

    await expect(operations.getInstalledBrowsers()).resolves.toEqual(['chrome', 'edge']);
    await expect(operations.checkBrowserCookies('chrome')).resolves.toEqual({ success: true, message: 'ok' });
    await expect(operations.getBilibiliQrCode()).resolves.toEqual(responses.get_bilibili_qrcode);
    await expect(operations.pollBilibiliQrCode('qr-key')).resolves.toEqual(responses.poll_bilibili_qrcode);
    await expect(operations.saveBilibiliCookies('cookie-value')).resolves.toBe('C:/tmp/bilibili_cookies.txt');
    await expect(operations.getBilibiliUserInfo('cookie-value')).resolves.toEqual(responses.get_bilibili_user_info);

    expect(calls).toEqual([
      { command: 'get_installed_browsers', args: undefined },
      { command: 'check_browser_cookies', args: { browser: 'chrome' } },
      { command: 'get_bilibili_qrcode', args: undefined },
      { command: 'poll_bilibili_qrcode', args: { qrcodeKey: 'qr-key' } },
      { command: 'save_bilibili_cookies', args: { cookieStr: 'cookie-value' } },
      { command: 'get_bilibili_user_info', args: { cookieStr: 'cookie-value' } },
    ]);
  });
});
