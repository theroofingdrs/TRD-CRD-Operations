import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function findChromium() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const name of ['chromium', 'google-chrome', 'google-chrome-stable']) {
    const result = spawnSync('which', [name], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  throw new Error('No Chromium executable found. Install the test browser or set CHROME_BIN.');
}

export async function startChromium({ executable = findChromium(), profile, timeoutMs = 60000, onStart = () => {} }) {
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000 });
  const versionText = (version.stdout || '').trim();
  if (version.error || version.status !== 0) throw new Error(`Chromium version check failed: executable=${executable}; status=${version.status}; error=${version.error?.message || 'none'}; stderr=${(version.stderr || '').slice(-8000)}`);
  console.log(`Chromium executable: ${executable}\nChromium version: ${versionText}`);
  let stderr = '', launchError;
  const child = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
  child.on('error', error => { launchError = error; });
  onStart(child);
  const diagnostic = reason => new Error(`${reason}\nexecutable=${executable}\nversion=${versionText}\npid=${child.pid ?? 'none'} exitCode=${child.exitCode} signal=${child.signalCode}\nlaunchError=${launchError?.message || 'none'}\nBrowser stderr (tail):\n${stderr || '(empty)'}`);
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (launchError || child.exitCode !== null || child.signalCode !== null) throw diagnostic('Chromium exited before DevTools became ready.');
    try {
      const portFile = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      const port = Number(portFile.split('\n')[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid DevTools port file');
      const base = `http://127.0.0.1:${port}`;
      const response = await fetch(base + '/json/version', { signal: AbortSignal.timeout(2000) });
      const info = response.ok ? await response.json() : null;
      if (typeof info?.webSocketDebuggerUrl !== 'string') throw Error('Invalid DevTools version response');
      return { child, base, version: versionText };
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw diagnostic(`Chromium startup timed out after ${timeoutMs}ms. Last readiness error: ${lastError?.message || 'none'}`);
}
