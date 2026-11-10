// Durable job records and the MPP replay store, in one local SQLite file.
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      state TEXT NOT NULL, progress TEXT, criteria TEXT NOT NULL,
      report TEXT, error TEXT, receipt TEXT
    );`);
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(jobs)').all().map((column) => column.name);
    if (!columns.includes('refund')) db.exec('ALTER TABLE jobs ADD COLUMN refund TEXT');
    if (!columns.includes('access_token_hash')) db.exec('ALTER TABLE jobs ADD COLUMN access_token_hash TEXT');
    if (!columns.includes('access_token_expires_at')) db.exec('ALTER TABLE jobs ADD COLUMN access_token_expires_at INTEGER');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}

// AtomicStore adapter for mppx replay protection (same design as experiments/mpp-lab/store.mjs).
export function replayStore(db) {
  const read = db.prepare('SELECT value FROM kv WHERE key = ?');
  const put = db.prepare('INSERT INTO kv VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const remove = db.prepare('DELETE FROM kv WHERE key = ?');
  const value = (key) => { const row = read.get(key); return row ? JSON.parse(row.value) : null; };
  return {
    async get(key) { return value(key); },
    async put(key, item) { put.run(key, JSON.stringify(item)); },
    async delete(key) { remove.run(key); },
    async update(key, fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const change = fn(value(key));
        if (!change || typeof change.then === 'function') throw new Error('Atomic update requires a synchronous Change');
        if (change.op === 'set') put.run(key, JSON.stringify(change.value));
        else if (change.op === 'delete') remove.run(key);
        else if (change.op !== 'noop') throw new Error('Invalid atomic operation');
        db.exec('COMMIT');
        return change.result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function jobStore(db) {
  const insert = db.prepare(`INSERT INTO jobs
    (id, created_at, updated_at, state, progress, criteria, receipt, access_token_hash, access_token_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const select = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const access = db.prepare('SELECT access_token_hash AS hash, access_token_expires_at AS expiresAt FROM jobs WHERE id = ?');
  const setState = db.prepare('UPDATE jobs SET state = ?, progress = ?, updated_at = ? WHERE id = ?');
  const finish = db.prepare('UPDATE jobs SET state = ?, report = ?, error = ?, progress = ?, updated_at = ? WHERE id = ?');
  const fail = db.prepare(`UPDATE jobs SET state = 'failed', report = NULL, error = ?, progress = 'failed', updated_at = ?,
    refund = CASE WHEN receipt IS NOT NULL AND refund IS NULL THEN '{"state":"pending"}' ELSE refund END WHERE id = ?`);
  const unfinished = db.prepare("SELECT id FROM jobs WHERE state IN ('queued', 'running') ORDER BY created_at");
  const refund = db.prepare(`UPDATE jobs SET refund = ?, updated_at = ? WHERE id = ?
    AND (? IS NULL OR json_extract(refund, '$.state') = ?)`);
  const pendingRefunds = db.prepare(`SELECT id FROM jobs WHERE state = 'failed'
    AND json_extract(refund, '$.state') IN ('pending', 'prepared') ORDER BY created_at`);
  const counts = db.prepare(`SELECT
    count(*) FILTER (WHERE state = 'done') AS completed,
    count(*) FILTER (WHERE json_extract(refund, '$.state') = 'sent') AS refunded
    FROM jobs`);
  const now = () => new Date().toISOString();
  const parse = (row) => row && ({
    id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, state: row.state, progress: row.progress,
    criteria: JSON.parse(row.criteria), report: row.report ? JSON.parse(row.report) : undefined,
    error: row.error ?? undefined, receipt: row.receipt ?? undefined,
    refund: row.refund ? JSON.parse(row.refund) : undefined,
  });
  return {
    create(id, criteria, receipt, { hash = null, expiresAt = null } = {}) {
      const t = now();
      insert.run(id, t, t, 'queued', 'waiting in queue', JSON.stringify(criteria), receipt ?? null, hash, expiresAt);
    },
    access(id) { return access.get(id); },
    get(id) { return parse(select.get(id)); },
    progress(id, state, text) { setState.run(state, text, now(), id); },
    complete(id, report) { finish.run('done', JSON.stringify(report), null, 'done', now(), id); },
    fail(id, message) { fail.run(message, now(), id); },
    unfinished() { return unfinished.all().map((row) => row.id); },
    pendingRefunds() { return pendingRefunds.all().map((row) => row.id); },
    setRefund(id, value, expected = null) { refund.run(JSON.stringify(value), now(), id, expected, expected); },
    counts() { return counts.get(); },
  };
}
