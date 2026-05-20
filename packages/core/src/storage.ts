/**
 * Storage adapter for persisting `WeeklyAggregation` rows.
 *
 * The default `JsonStorage` writes one JSON file per (week × tool) under
 * `<rootDir>/aggregations/<weekStart>/<tool>.json`. This keeps the layout
 * grep-friendly and diffable in Git when the user opts in.
 *
 * The `StorageAdapter` interface is intentionally minimal so we can later
 * swap to `surch` or `opendb` (sibling repos) without touching callers.
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { WeeklyAggregation } from './aggregations.js';
import type { Tool } from './schema.js';

export interface StorageFilter {
  weekStart?: string;
  projectCwd?: string;
  tool?: Tool;
}

export interface StorageAdapter {
  save(rows: WeeklyAggregation[]): Promise<void>;
  load(filter?: StorageFilter): Promise<WeeklyAggregation[]>;
}

export interface JsonStorageOptions {
  /** Root dir; defaults to ~/.agent-stats. */
  rootDir?: string;
}

const DEFAULT_HOME = (): string => process.env['HOME'] ?? '';

export class JsonStorage implements StorageAdapter {
  private readonly rootDir: string;

  constructor(opts: JsonStorageOptions = {}) {
    this.rootDir = opts.rootDir ?? path.join(DEFAULT_HOME(), '.agent-stats');
  }

  private aggDir(): string {
    return path.join(this.rootDir, 'aggregations');
  }

  async save(rows: WeeklyAggregation[]): Promise<void> {
    if (rows.length === 0) return;
    const byBucket = new Map<string, WeeklyAggregation[]>();
    for (const r of rows) {
      const key = `${r.weekStart}/${r.tool}`;
      let arr = byBucket.get(key);
      if (!arr) {
        arr = [];
        byBucket.set(key, arr);
      }
      arr.push(r);
    }
    for (const [key, list] of byBucket) {
      const [week, tool] = key.split('/');
      if (!week || !tool) continue;
      const dir = path.join(this.aggDir(), week);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${tool}.json`);
      // merge with existing rows in the same file: replace on same key
      // (weekStart, projectCwd, tool, model).
      let existing: WeeklyAggregation[] = [];
      try {
        const raw = await readFile(file, 'utf8');
        existing = JSON.parse(raw) as WeeklyAggregation[];
      } catch {
        existing = [];
      }
      const keyOf = (r: WeeklyAggregation): string =>
        `${r.weekStart}|${r.projectCwd}|${r.tool}|${r.model}`;
      const merged = new Map<string, WeeklyAggregation>();
      for (const r of existing) merged.set(keyOf(r), r);
      for (const r of list) merged.set(keyOf(r), r);
      const out = [...merged.values()].sort(
        (a, b) => a.projectCwd.localeCompare(b.projectCwd) || a.model.localeCompare(b.model),
      );
      await writeFile(file, `${JSON.stringify(out, null, 2)}\n`);
    }
  }

  async load(filter: StorageFilter = {}): Promise<WeeklyAggregation[]> {
    let weeks: string[];
    try {
      weeks = await readdir(this.aggDir());
    } catch {
      return [];
    }
    if (filter.weekStart) weeks = weeks.filter((w) => w === filter.weekStart);
    const out: WeeklyAggregation[] = [];
    for (const w of weeks) {
      const dir = path.join(this.aggDir(), w);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const tool = f.replace(/\.json$/, '') as Tool;
        if (filter.tool && filter.tool !== tool) continue;
        const file = path.join(dir, f);
        try {
          const raw = await readFile(file, 'utf8');
          const rows = JSON.parse(raw) as WeeklyAggregation[];
          for (const r of rows) {
            if (filter.projectCwd) {
              if (filter.projectCwd.endsWith('/')) {
                if (!r.projectCwd.startsWith(filter.projectCwd)) continue;
              } else if (r.projectCwd !== filter.projectCwd) continue;
            }
            out.push(r);
          }
        } catch {
          continue;
        }
      }
    }
    return out;
  }
}
