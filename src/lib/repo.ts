import { repository, defaultBranch } from '../../package.json';

function parseGitHubRepoSlug(repoUrl: string): string {
  const cleaned = repoUrl.replace(/^git\+/, '').replace(/\.git$/, '');
  const match = cleaned.match(/github\.com[/:]([^/]+\/[^/]+)$/);
  return match ? match[1] : 'Sandakan/UPSED';
}

const repoUrl = typeof repository === 'string' ? repository : repository.url;

/** GitHub `owner/repo` slug derived from `package.json`. */
export const REPO_SLUG = parseGitHubRepoSlug(repoUrl);

/** Default repository branch derived from `package.json`. */
export const REPO_BRANCH = defaultBranch || 'master';

/** Base GitHub repository URL. */
export const REPO_URL = `https://github.com/${REPO_SLUG}`;

/** Raw GitHub URL for the desktop app changelog. */
export const APP_CHANGELOG_RAW_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/${REPO_BRANCH}/CHANGELOG.md`;

/** Web GitHub URL for the desktop app changelog. */
export const APP_CHANGELOG_BLOB_URL = `${REPO_URL}/blob/${REPO_BRANCH}/CHANGELOG.md`;

/** Raw GitHub URL for the ESP32 bridge firmware changelog. */
export const BRIDGE_CHANGELOG_RAW_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/${REPO_BRANCH}/upsed-bridge/CHANGELOG.md`;

/** Web GitHub URL for the ESP32 bridge firmware changelog. */
export const BRIDGE_CHANGELOG_BLOB_URL = `${REPO_URL}/blob/${REPO_BRANCH}/upsed-bridge/CHANGELOG.md`;
