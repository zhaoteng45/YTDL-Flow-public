import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createI18n } from 'vue-i18n';

import CapturePanel from '../../src/components/CapturePanel.vue';
import type { CaptureFacade } from '../../src/v2-runtime/capture/captureFacade';
import type {
  CapturedResourceSummary,
  CaptureSessionStatus,
} from '../../packages/contracts/src';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';

const sanitizedResources: CapturedResourceSummary[] = [
  {
    captureId: 'capture-1',
    resourceId: 'resource-1',
    resourceNumber: 1,
    siteLabel: 'cdn.example.com',
    mediaKind: 'hls',
    mimeType: 'application/vnd.apple.mpegurl',
    sizeBytes: 4_194_304,
    filenameHint: 'master.m3u8',
    resolutionHint: '1080p',
    requiresAuthenticatedReplay: false,
  },
  {
    captureId: 'capture-1',
    resourceId: 'resource-2',
    resourceNumber: 2,
    siteLabel: 'media.example.org',
    mediaKind: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 65_536,
    filenameHint: 'clip.mp4',
    requiresAuthenticatedReplay: true,
  },
];

function facade(): CaptureFacade {
  const resources = sanitizedResources;
  const session: CaptureSessionStatus = {
    active: true,
    captureId: 'capture-1',
    browserName: 'msedge',
  };
  return {
    async start() {},
    async stop() {},
    async importResource() {
      return { type: 'imported', rowId: 'row-1', contextId: 'context-1' };
    },
    async revokeRow() {},
    async list() {
      return resources;
    },
    subscribeResources(listener) {
      listener(resources);
      return () => {};
    },
    subscribeSession(listener) {
      listener(session);
      return () => {};
    },
  };
}

async function renderPanel(locale: 'zh-CN' | 'en-US'): Promise<string> {
  const i18n = createI18n({
    legacy: false,
    locale,
    messages: { 'zh-CN': zh, 'en-US': en },
  });
  const app = createSSRApp({
    components: { CapturePanel },
    // CapturePanel expects a `capture` prop; template-level props are not used here.
    template: '<CapturePanel :capture="capture" />',
    data: () => ({ capture: facade() }),
  });
  app.use(i18n as never);
  return await renderToString(app);
}

describe('CapturePanel rendering', () => {
  it('renders only sanitized candidate information', async () => {
    const html = await renderPanel('zh-CN');

    expect(html).toContain('#1');
    expect(html).toContain('cdn.example.com');
    expect(html).toContain('HLS');
    expect(html).toContain('application/vnd.apple.mpegurl');
    expect(html).toContain('4.00 MB');
    expect(html).toContain('master.m3u8');
    expect(html).toContain('1080p');
    expect(html).toContain('#2');
    expect(html).toContain('media.example.org');

    // No raw/executable address may appear anywhere in the rendered UI. The
    // SVG namespace is not an address, so it is stripped before the check.
    const withoutSvgNamespace = html.replace(
      /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g,
      '',
    );
    expect(withoutSvgNamespace).not.toMatch(/https?:\/\//);
    expect(withoutSvgNamespace).not.toMatch(/sig=|token=|Authorization|Cookie/i);
    expect(withoutSvgNamespace).not.toMatch(/\?[a-z]+=/i);
  });

  it('explains authenticated-replay resources and disables their action', async () => {
    const html = await renderPanel('zh-CN');

    expect(html).toContain('当前 Phase 1 不支持此资源的认证重放');
    const disabledButtons = html.match(/<button[^>]*disabled[^>]*>/g) ?? [];
    expect(disabledButtons.length).toBeGreaterThanOrEqual(1);

    const english = await renderPanel('en-US');
    expect(english).toContain('Phase 1 cannot replay credentials for this resource');
  });

  it('shows the isolated-instance copy and the capture status', async () => {
    const html = await renderPanel('zh-CN');
    expect(html).toContain('msedge');
    expect(html).toContain('独立临时配置');
    expect(html).toContain('不会修改系统代理');
  });

  it('uses design tokens only (no hard-coded colors)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve('src/components/CapturePanel.vue'),
      'utf8',
    );

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(/);
    expect(source).not.toMatch(/\bhsla?\(/);
    expect(source).toContain('var(--color-border)');
    expect(source).toContain('var(--color-primary)');
  });
});
