import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyResponsiveAssets } from './verify-responsive-assets.mjs';

test('public stylesheet verification accepts tested bytes, rejects stale CSS and HTTP errors without touching private routes', async () => {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'crm-asset-probe-'));
  const html = '<link rel="stylesheet" href="/assets/index.css">';
  const css = '.customer-service-history{display:grid;grid-template-columns:minmax(0,1fr)}';
  let stale = false, unavailable = false;
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (unavailable) { response.writeHead(503); response.end(); return; }
    response.end(request.url === '/' ? html : stale ? css + 'body{overflow-x:hidden}' : css);
  });
  try {
    await mkdir(path.join(dist, 'assets'));
    await writeFile(path.join(dist, 'index.html'), html); await writeFile(path.join(dist, 'assets/index.css'), css);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const result = await verifyResponsiveAssets({ dist, url });
    assert.equal(result.stylesheetMatch, true); assert.equal(result.authenticatedMobileVerified, false);
    stale = true;
    await assert.rejects(verifyResponsiveAssets({ dist, url }), /Served CSS differs/);
    unavailable = true;
    await assert.rejects(verifyResponsiveAssets({ dist, url }), /HTTP 503/);
    assert(requests.every(request => request.method === 'GET' && ['/', '/assets/index.css'].includes(request.url)));
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dist, { recursive: true, force: true }); }
});
