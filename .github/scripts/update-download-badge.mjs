import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Keep this allowlist in sync with the application's published package formats.
export const PACKAGE_NAME = /^ScriptPlayerPlus[-.].*\.(exe|zip|dmg|deb|AppImage|tar\.gz)$/i;

export function countDownloads(releases) {
  const totals = { downloads: 0, stable: 0, prerelease: 0, excluded: 0 };
  const platforms = { Windows: 0, macOS: 0, Linux: 0 };
  const versions = [];
  const assets = [];
  const seen = new Set();
  for (const release of releases) {
    if (release.draft) continue;
    const version = { tag: release.tag_name, prerelease: release.prerelease, downloads: 0 };
    if (!Array.isArray(release.assets)) throw new Error('Missing release assets');
    for (const asset of release.assets) {
      if (seen.has(asset.id)) throw new Error('Duplicate release asset');
      seen.add(asset.id);
      const count = asset.download_count;
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid download count');
      if (!PACKAGE_NAME.test(asset.name)) {
        totals.excluded += count;
        continue;
      }
      const platform = /\.exe$|-(win|windows)-/i.test(asset.name) ? 'Windows'
        : /-mac[.-]|\.dmg$/i.test(asset.name) ? 'macOS'
          : /-linux-|\.(AppImage|deb)$/i.test(asset.name) ? 'Linux' : null;
      if (!platform) throw new Error(`Unknown package platform: ${asset.name}`);
      totals.downloads += count;
      totals[release.prerelease ? 'prerelease' : 'stable'] += count;
      version.downloads += count;
      platforms[platform] += count;
      assets.push({ release: release.tag_name, name: asset.name, downloads: count });
    }
    versions.push(version);
  }
  // Fail instead of replacing the published badge with zero on an incomplete response.
  if (!assets.length) throw new Error('No application packages found');
  return { totals, platforms, releases: versions, assets };
}

export async function fetchReleases(repository, token, request = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  const releases = [];
  for (let page = 1; ; page += 1) {
    const response = await request(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub releases request failed: HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Invalid releases response');
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

export function renderBadge(count) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid badge count');
  const value = count.toLocaleString('en-US');
  const left = 78;
  const right = value.length * 7 + 14;
  const width = left + right;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="Downloads: ${value}">
  <title>Application package downloads: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)"><path fill="#555" d="M0 0h${left}v20H0z"/><path fill="#007ec6" d="M${left} 0h${right}v20H${left}z"/><path fill="url(#s)" d="M0 0h${width}v20H0z"/></g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${left / 2}" y="15" fill="#010101" fill-opacity=".3">Downloads</text><text x="${left / 2}" y="14">Downloads</text>
    <text x="${left + right / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="${left + right / 2}" y="14">${value}</text>
  </g>
</svg>
`;
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output-dir');
  if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('--output-dir is required');
  const inputIndex = args.indexOf('--input');
  const repository = process.env.GITHUB_REPOSITORY || 'sioaeko/scriptplayer-plus';
  const releases = inputIndex >= 0
    ? JSON.parse((await readFile(args[inputIndex + 1], 'utf8')).replace(/^\uFEFF/, '')).flat()
    : await fetchReleases(repository, process.env.GH_TOKEN);
  const result = countDownloads(releases);
  const directory = resolve(args[outputIndex + 1]);
  const statistics = {
    repository,
    scope: 'Currently published GitHub installers and application archives, including prereleases. Repeat downloads and updates count separately. Deleted/replaced assets and other distribution channels are not included.',
    packagePattern: PACKAGE_NAME.source,
    excluded: 'Update manifests, blockmaps, hotfix metadata, checksums, documentation and media.',
    ...result,
  };
  const badge = { schemaVersion: 1, label: 'Downloads', message: result.totals.downloads.toLocaleString('en-US'), color: 'blue' };
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(resolve(directory, 'downloads.svg'), renderBadge(result.totals.downloads)),
    writeFile(resolve(directory, 'downloads.json'), JSON.stringify(badge, null, 2) + '\n'),
    writeFile(resolve(directory, 'statistics.json'), JSON.stringify(statistics, null, 2) + '\n'),
  ]);
  console.log(`Application packages: ${result.totals.downloads}; excluded attachments: ${result.totals.excluded}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
