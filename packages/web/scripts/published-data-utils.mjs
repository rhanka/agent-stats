const DAY_MS = 86_400_000;
const PRIVATE_LABEL_RE = /^private-\d+$/;
const PUBLIC_GIT_HOSTS = new Set(['github.com', 'gitlab.com']);
const LOCAL_PATH_OWNERS = new Set(['home', 'src', 'tmp', 'Users']);

export function isPrivateLabel(label) {
  return PRIVATE_LABEL_RE.test(label);
}

function rowPeriod(row) {
  return row.weekStart ?? '';
}

function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      rowPeriod(a).localeCompare(rowPeriod(b)) ||
      String(a.projectCwd ?? '').localeCompare(String(b.projectCwd ?? '')) ||
      String(a.tool ?? '').localeCompare(String(b.tool ?? '')) ||
      String(a.model ?? '').localeCompare(String(b.model ?? '')),
  );
}

export function periodStartForIncremental(now = new Date(), days = 21) {
  const d = new Date(now.getTime() - days * DAY_MS);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return monday.toISOString().slice(0, 10);
}

export function publicRepoFromRemote(remote) {
  const value = String(remote ?? '').trim();
  let host = '';
  let slug = '';

  const ssh = value.match(/^git@([^:]+):([^/:\s]+\/[^/\s]+?)(?:\.git)?$/);
  if (ssh) {
    host = ssh[1];
    slug = ssh[2];
  } else {
    const https = value.match(/^https?:\/\/([^/]+)\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
    if (https) {
      host = https[1];
      slug = https[2];
    }
  }

  if (!host || !slug || !PUBLIC_GIT_HOSTS.has(host)) return null;
  const owner = slug.split('/')[0];
  if (LOCAL_PATH_OWNERS.has(owner)) return null;
  const cleanSlug = slug.replace(/\.git$/, '');
  return { label: cleanSlug, url: `https://${host}/${cleanSlug}` };
}

export function scrubInvalidRepoRows(rows) {
  for (const row of rows) {
    if (!row.repoUrl) continue;
    const repo = publicRepoFromRemote(row.repoUrl);
    if (!repo || repo.label !== row.projectCwd) {
      delete row.repoUrl;
    }
  }
  return rows;
}

export function mergeIncrementalRows(existing, refreshed, sincePeriod) {
  return sortRows([...existing.filter((row) => rowPeriod(row) < sincePeriod), ...refreshed]);
}

function anomalyKey(row) {
  return [row.sessionId, row.tool, row.type].join('|');
}

export function mergeAnomaliesByKey(existing, refreshed) {
  const refreshedKeys = new Set(refreshed.map(anomalyKey));
  return [...refreshed, ...existing.filter((row) => !refreshedKeys.has(anomalyKey(row)))];
}

function nextPrivateIndex(rows) {
  let max = 0;
  for (const row of rows) {
    const label = String(row.projectCwd ?? '');
    if (!isPrivateLabel(label)) continue;
    const n = Number(label.slice('private-'.length));
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

function rowTokenTotal(row) {
  const u = row.totalUsage ?? {};
  return (
    (u.newInputTokens ?? 0) +
    (u.cachedInputTokens ?? 0) +
    (u.cacheWriteTokens ?? 0) +
    (u.outputTokens ?? 0)
  );
}

/** Build a stable label -> private-N map for non-public rows.
 *
 * Existing `private-N` labels are already anonymized published data and are
 * preserved. New private labels are appended after the highest existing N.
 */
export function buildPrivateMap(rows) {
  const totals = new Map();
  for (const row of rows) {
    const label = String(row.projectCwd ?? '');
    if (row.repoUrl || isPrivateLabel(label)) continue;
    totals.set(label, (totals.get(label) ?? 0) + rowTokenTotal(row));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  let next = nextPrivateIndex(rows);
  return new Map(ranked.map((label) => [label, `private-${next++}`]));
}

export function anonymize(rows, privateMap) {
  for (const row of rows) {
    const label = String(row.projectCwd ?? '');
    if (!row.repoUrl && !isPrivateLabel(label) && privateMap.has(label)) {
      row.projectCwd = privateMap.get(label);
    }
  }
  return rows;
}
