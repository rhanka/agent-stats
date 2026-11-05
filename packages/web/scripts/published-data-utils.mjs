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

function periodToolKey(row) {
  return `${rowPeriod(row)}|${row.tool ?? ''}`;
}

function sessionsByKey(rows) {
  const totals = new Map();
  for (const row of rows) {
    const key = periodToolKey(row);
    totals.set(key, (totals.get(key) ?? 0) + (row.sessions ?? 0));
  }
  return totals;
}

/**
 * Replace the rows of the recalculated window with the refreshed ones — except
 * where the local transcripts are gone: Claude Code purges sessions after
 * `cleanupPeriodDays` (30 by default), so recomputing an old period yields
 * fewer sessions than were published. For each (period, tool) whose refreshed
 * session count is lower than the published one, the published rows are kept.
 * Kept keys are pushed to `retained` (optional) for reporting.
 */
export function mergeIncrementalRows(existing, refreshed, sincePeriod, retained = []) {
  const before = existing.filter((row) => rowPeriod(row) < sincePeriod);
  const window = existing.filter((row) => rowPeriod(row) >= sincePeriod);
  const oldTotals = sessionsByKey(window);
  const newTotals = sessionsByKey(refreshed);
  const keep = new Set(
    [...oldTotals].filter(([key, n]) => (newTotals.get(key) ?? 0) < n).map(([key]) => key),
  );
  retained.push(...[...keep].sort());
  return sortRows([
    ...before,
    ...window.filter((row) => keep.has(periodToolKey(row))),
    ...refreshed.filter((row) => !keep.has(periodToolKey(row))),
  ]);
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

/**
 * Self-healing incremental window: rebuild everything since the previous
 * publication (`meta.generatedAt`) plus a safety margin, so a publisher that
 * was down for weeks catches up on its next run instead of leaving holes.
 * Returns null when there is no usable previous publication.
 */
export function incrementalDaysSinceMeta(meta, now = new Date(), marginDays = 7, minDays = 3) {
  const at = Date.parse(meta?.generatedAt ?? '');
  if (!Number.isFinite(at)) return null;
  const elapsed = Math.max(0, Math.ceil((now.getTime() - at) / DAY_MS));
  return Math.max(minDays, elapsed + marginDays);
}
