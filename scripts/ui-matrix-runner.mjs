import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();

export class CdpCallTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super(`CDP ${method} timed out after ${timeoutMs}ms`);
    this.name = 'CdpCallTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export async function navigateWithTransportRetry(call, url) {
  try {
    return await call('Page.navigate', { url });
  } catch (error) {
    if (!(error instanceof CdpCallTimeoutError) || error.method !== 'Page.navigate') {
      throw error;
    }
    return call('Page.navigate', { url });
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate port')));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Microsoft Edge not found. Set EDGE_PATH to msedge.exe.');
  return found;
}

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(200);
  }
  throw new Error(`${label} did not become ready: ${lastError ?? 'timeout'}`);
}

async function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
    return;
  }
  child.kill('SIGTERM');
}

export async function runUiMatrix({
  harnessPath,
  resultGlobal = '__YTDL_UI_MATRIX__',
  outDirName,
  screenshotName = 'final.png',
  timeoutMs = 90_000,
  viewportWidth = 1360,
  viewportHeight = 1600,
  auditCases,
}) {
  if (!harnessPath?.startsWith('/')) {
    throw new Error('harnessPath must be an absolute Vite path beginning with /');
  }
  if (!outDirName) throw new Error('outDirName is required');

  const outDir = path.join(root, '.scratch', outDirName);
  mkdirSync(outDir, { recursive: true });
  // Edge copies extension HTML into its profile during startup. Keep that
  // generated tree outside Vite's watched workspace to prevent reload loops.
  const vitePort = await getFreePort();
  const debugPort = await getFreePort();
  const harnessUrl = `http://127.0.0.1:${vitePort}${harnessPath}`;
  const edgeExe = findEdge();
  const profileDir = mkdtempSync(path.join(tmpdir(), 'ytdl-ui-matrix-'));

  let vite;
  let edge;
  let ws;

  try {
    vite = spawn(
      process.execPath,
      ['--bun', 'vite', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let viteStderr = '';
    // Drain stdout: an unread pipe can stall Vite while profiles/artifacts change.
    vite.stdout?.on('data', () => {});
    vite.stderr?.on('data', (chunk) => {
      viteStderr += chunk.toString();
    });

    await waitFor(harnessUrl, 20_000, 'Vite harness');

    edge = spawn(
      edgeExe,
      [
        '--headless=new',
        '--edge-skip-compat-layer-relaunch',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-proxy-server',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        `--window-size=${viewportWidth},${viewportHeight}`,
        'about:blank',
      ],
      {
        cwd: root,
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    await waitFor(`http://127.0.0.1:${debugPort}/json`, 20_000, 'Edge CDP');
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
    const target = targets.find((candidate) => candidate.type === 'page') ?? targets[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('Edge CDP page target not found');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket timeout')), 5_000);
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        'error',
        (event) => {
          clearTimeout(timer);
          reject(event);
        },
        { once: true },
      );
    });

    let seq = 0;
    const pending = new Map();
    const cdpCallTimeoutMs = Math.min(10_000, Math.max(1_000, timeoutMs));

    const rejectPending = (error) => {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      pending.clear();
    };

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
    ws.addEventListener('close', () => {
      rejectPending(new Error('CDP WebSocket closed'));
    });
    ws.addEventListener('error', () => {
      rejectPending(new Error('CDP WebSocket error'));
    });

    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(new CdpCallTimeoutError(method, cdpCallTimeoutMs));
        }, cdpCallTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          ws.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });

    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };

    // Close through CDP as well: Edge may relaunch beyond the spawned PID.
    ws.closeBrowser = () => call('Browser.close');

    await call('Runtime.enable');
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const cases = auditCases ?? [{ name: screenshotName, width: viewportWidth, height: viewportHeight }];
    const results = [];
    for (const auditCase of cases) {
      await call('Emulation.setDeviceMetricsOverride', {
        width: auditCase.width, height: auditCase.height ?? viewportHeight,
        deviceScaleFactor: auditCase.deviceScaleFactor ?? 1, mobile: false,
      });
      await navigateWithTransportRetry(call, harnessUrl + (auditCase.query ?? ''));
      const deadline = Date.now() + timeoutMs;
      let current;
      while (Date.now() < deadline) {
        current = await evaluate(`window[${JSON.stringify(resultGlobal)}] ?? null`);
        if (current?.done) break;
        await Bun.sleep(250);
      }
      if (!current?.done) throw new Error(`UI matrix timed out after ${timeoutMs}ms: ${auditCase.name}`);
      await evaluate('window.scrollTo(0, 0)');
      const capture = await call('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: true,
      });
      await Bun.write(path.join(outDir, auditCase.name), Buffer.from(capture.data, 'base64'));
      results.push({ name: auditCase.name, width: auditCase.width, height: auditCase.height ?? viewportHeight,
        deviceScaleFactor: auditCase.deviceScaleFactor ?? 1,
        physicalResolution: auditCase.physicalResolution,
        windowsScaling: auditCase.windowsScaling,
        approximation: auditCase.approximation,
        screenshotPath: path.relative(root, path.join(outDir, auditCase.name)).replaceAll('\\', '/'),
        ...current });
    }
    const result = auditCases ? {
      done: true,
      passed: results.reduce((sum, current) => sum + current.passed, 0),
      total: results.reduce((sum, current) => sum + current.total, 0),
      failures: results.flatMap(current => current.failures.map(failure => ({ case: current.name, ...failure }))),
      scenarios: results.map(current => current.name),
      cases: results,
    } : results[0];

    const resultFile = path.join(outDir, 'result.json');
    await Bun.write(
      resultFile,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          harnessUrl,
          ...result,
        },
        null,
        2,
      ),
    );

    const screenshot = await call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
    });
    const screenshotFile = path.join(outDir, screenshotName);
    await Bun.write(screenshotFile, Buffer.from(screenshot.data, 'base64'));

    const summary = {
      verdict: result.failures?.length ? 'FAIL' : 'PASS',
      combinations: result.total,
      ...(Array.isArray(result.scenarios)
        ? {
            semanticScenarios: result.scenarios.length,
            scenarios: result.scenarios,
          }
        : {}),
      passedChecks: result.passed,
      ...(result.failures?.length ? { failures: result.failures } : {}),
      resultFile,
      screenshot: screenshotFile,
    };

    if (result.failures?.length) {
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(summary, null, 2));
    }

    if (vite.exitCode !== null && vite.exitCode !== 0) {
      throw new Error(`Vite exited early (${vite.exitCode}): ${viteStderr}`);
    }

    return summary;
  } finally {
    try { await ws?.closeBrowser?.(); } catch {}
    try {
      ws?.close();
    } catch {}
    await killTree(edge);
    await killTree(vite);
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // A just-terminated Edge process can hold Windows profile files briefly.
      // Profiles are unique per run, so a delayed cleanup cannot block later audits.
    }
  }
}
