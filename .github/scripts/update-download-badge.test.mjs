import assert from 'node:assert/strict';
import test from 'node:test';
import { countDownloads, fetchReleases, renderBadge } from './update-download-badge.mjs';

const release = (names, options = {}) => ({ tag_name: 'v1.0.0', draft: false, prerelease: false, assets: names.map((name, id) => ({ id, name, download_count: 10 })), ...options });

test('counts legacy and current packages but excludes every kind of auxiliary attachment', () => {
  const result = countDownloads([release([
    'ScriptPlayerPlus.Setup.0.2.7.exe', 'ScriptPlayerPlus-v0.7.0-win-x64.zip',
    'ScriptPlayerPlus-0.7.0-arm64-mac.dmg', 'ScriptPlayerPlus-0.1.1-mac-intel.zip',
    'ScriptPlayerPlus-0.2.4.AppImage', 'ScriptPlayerPlus-0.7.0-linux-amd64.deb', 'ScriptPlayerPlus-0.7.0-linux-x64.tar.gz',
    'latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'hotfix.json',
    'ScriptPlayerPlus-Setup-0.7.0.exe.blockmap', 'ScriptPlayerPlus-0.7.0-arm64-mac.zip.blockmap',
    'SHA256SUMS.txt', 'UPDATE_AND_RECOVERY.md', 'preview.png', 'source.zip',
  ])]);
  assert.deepEqual(result.totals, { downloads: 70, stable: 70, prerelease: 0, excluded: 100 });
  assert.deepEqual(result.platforms, { Windows: 20, macOS: 20, Linux: 30 });
});

test('includes prereleases and omits drafts even with an authenticated token', () => {
  const result = countDownloads([
    release(['ScriptPlayerPlus-v0.7.1-beta.1-win-x64.zip'], { prerelease: true }),
    release(['ScriptPlayerPlus-v0.8.0-win-x64.zip'], { draft: true }),
  ]);
  assert.equal(result.totals.downloads, 10);
  assert.equal(result.totals.prerelease, 10);
  assert.equal(result.releases.length, 1);
});

test('does not double-count duplicate assets or publish corrupt/empty results', () => {
  const fixture = release(['ScriptPlayerPlus-Setup-1.0.0.exe']);
  assert.throws(() => countDownloads([fixture, fixture]), /Duplicate/);
  assert.throws(() => countDownloads([]), /No application/);
  fixture.assets[0].download_count = -1;
  assert.throws(() => countDownloads([fixture]), /Invalid download/);
});

test('fetches every release page instead of stopping at the first 100', async () => {
  const requests = [];
  const result = await fetchReleases('sioaeko/scriptplayer-plus', undefined, async url => {
    requests.push(url);
    return { ok: true, json: async () => requests.length === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }] };
  });
  assert.equal(result.length, 101);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /page=2$/);
});

test('fails on a later API error rather than publishing a partial count', async () => {
  let page = 0;
  await assert.rejects(fetchReleases('sioaeko/scriptplayer-plus', undefined, async () => {
    page += 1;
    return page === 1 ? { ok: true, json: async () => Array(100).fill({}) } : { ok: false, status: 403 };
  }), /HTTP 403/);
});

test('badge displays the exact package count with an accessible label', () => {
  assert.match(renderBadge(12921), /aria-label="Downloads: 12,921"/);
  assert.throws(() => renderBadge(NaN), /Invalid badge/);
});
