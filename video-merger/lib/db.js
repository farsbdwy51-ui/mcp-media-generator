// lib/db.js — عميل Turso + إنشاء المخطط + عمليات المهام
// كل البيانات (مهام، مصادر، أجزاء ملفات، الناتج) تُخزَّن في Turso عبر HTTP
'use strict';

const { createClient } = require('@libsql/client');

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_DATABASE_URL و TURSO_AUTH_TOKEN مطلوبان في البيئة');
  }
  _client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return _client;
}

// إنشاء الجداول عند أول وصول — لا حاجة لأداة migrations
async function ensureSchema() {
  const db = getClient();
  await db.batch([
    `CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER DEFAULT 0,
      sources_json TEXT DEFAULT '[]',
      result_url TEXT,
      download_url TEXT,
      size INTEGER,
      duration REAL,
      resolution TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      url TEXT,
      name TEXT,
      size INTEGER,
      mime TEXT,
      status TEXT DEFAULT 'pending',
      duration REAL,
      width INTEGER,
      height INTEGER,
      fps REAL,
      has_audio INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS source_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS output_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data BLOB NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sources_job ON sources(job_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chunks_source ON source_chunks(source_id, seq)`,
    `CREATE INDEX IF NOT EXISTS idx_output_job ON output_chunks(job_id, seq)`,
  ]);
}

async function dbHealthy() {
  try {
    const db = getClient();
    await db.execute('SELECT 1 as ok');
    return true;
  } catch {
    return false;
  }
}

// توليد معرف عشوائي قصير
function genId(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// إنشاء مهمة جديدة
async function createJob({ sources, expiresAt }) {
  const db = getClient();
  const id = genId(12);
  await db.execute({
    sql: `INSERT INTO jobs (id, status, sources_json, expires_at) VALUES (?, 'queued', ?, ?)`,
    args: [id, JSON.stringify(sources), expiresAt],
  });
  // أضف صفوف المصادر
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const sid = genId(12);
    await db.execute({
      sql: `INSERT INTO sources (id, job_id, seq, kind, url, name, size, mime, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      args: [sid, id, i, s.kind, s.url || null, s.name || null, s.size || null, s.mime || null],
    });
    s._id = sid;
  }
  return { id, sources };
}

async function getJob(id) {
  const db = getClient();
  const r = await db.execute({ sql: `SELECT * FROM jobs WHERE id = ?`, args: [id] });
  return r.rows[0] || null;
}

async function getSources(jobId) {
  const db = getClient();
  const r = await db.execute({ sql: `SELECT * FROM sources WHERE job_id = ? ORDER BY seq ASC`, args: [jobId] });
  return r.rows;
}

async function updateJob(id, patch) {
  const db = getClient();
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    args.push(v);
  }
  sets.push(`updated_at = datetime('now')`);
  args.push(id);
  await db.execute({ sql: `UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`, args });
}

async function updateSource(id, patch) {
  const db = getClient();
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    args.push(v);
  }
  args.push(id);
  await db.execute({ sql: `UPDATE sources SET ${sets.join(', ')} WHERE id = ?`, args });
}

// تخزين جزء من ملف مصدر
async function appendSourceChunk(sourceId, seq, buf) {
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO source_chunks (source_id, seq, data) VALUES (?, ?, ?)`,
    args: [sourceId, seq, buf],
  });
}

// قراءة كل أجزاء مصدر كـ Buffer
async function readSourceBytes(sourceId) {
  const db = getClient();
  // قراءة تدريجية بصفحات 8 صفوف لتقليل الذاكرة
  const chunks = [];
  let offset = 0;
  const pageSize = 8;
  while (true) {
    const r = await db.execute({
      sql: `SELECT seq, data FROM source_chunks WHERE source_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?`,
      args: [sourceId, pageSize, offset],
    });
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      chunks.push(Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data));
    }
    offset += r.rows.length;
    if (r.rows.length < pageSize) break;
  }
  return Buffer.concat(chunks);
}

// تخزين الناتج على شكل أجزاء 2MB
async function storeOutput(jobId, buf) {
  const db = getClient();
  const chunkSize = 2 * 1024 * 1024; // 2MB — حد صف Turso
  const total = Math.ceil(buf.length / chunkSize);
  for (let i = 0; i < total; i++) {
    const slice = buf.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, buf.length));
    await db.execute({
      sql: `INSERT INTO output_chunks (job_id, seq, data) VALUES (?, ?, ?)`,
      args: [jobId, i, slice],
    });
  }
}

// قراءة الناتج بتدفق (دعم Range: start, end بايتات)
async function streamOutput(jobId, start, end) {
  const db = getClient();
  const chunkSize = 2 * 1024 * 1024;
  // حدّد الأجزاء المطلوبة
  const firstChunk = Math.floor(start / chunkSize);
  const lastChunk = Math.floor(end / chunkSize);
  const r = await db.execute({
    sql: `SELECT seq, data FROM output_chunks WHERE job_id = ? AND seq >= ? AND seq <= ? ORDER BY seq ASC`,
    args: [jobId, firstChunk, lastChunk],
  });
  const chunks = [];
  for (const row of r.rows) {
    chunks.push(Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data));
  }
  if (chunks.length === 0) return null;
  const fullBuf = Buffer.concat(chunks);
  const localStart = start - firstChunk * chunkSize;
  const localEnd = end - firstChunk * chunkSize;
  return fullBuf.subarray(localStart, localEnd + 1);
}

async function getOutputSize(jobId) {
  const db = getClient();
  const r = await db.execute({
    sql: `SELECT SUM(LENGTH(data)) as total FROM output_chunks WHERE job_id = ?`,
    args: [jobId],
  });
  const t = r.rows[0]?.total;
  return t ? Number(t) : 0;
}

// حذف شامل لمهمة (jobs + sources + source_chunks + output_chunks)
async function deleteJob(id) {
  const db = getClient();
  await db.batch([
    { sql: `DELETE FROM source_chunks WHERE source_id IN (SELECT id FROM sources WHERE job_id = ?)`, args: [id] },
    { sql: `DELETE FROM sources WHERE job_id = ?`, args: [id] },
    { sql: `DELETE FROM output_chunks WHERE job_id = ?`, args: [id] },
    { sql: `DELETE FROM jobs WHERE id = ?`, args: [id] },
  ]);
}

// حذف source_chunks بعد نجاح الدمج (للحفاظ على المساحة)
async function deleteSourceChunks(jobId) {
  const db = getClient();
  await db.execute({
    sql: `DELETE FROM source_chunks WHERE source_id IN (SELECT id FROM sources WHERE job_id = ?)`,
    args: [jobId],
  });
}

// التنظيف الكسول: احذف المهام المنتهية قبل إنشاء/معالجة مهمة جديدة
async function cleanupExpired() {
  const db = getClient();
  const now = new Date().toISOString();
  const r = await db.execute({
    sql: `SELECT id FROM jobs WHERE expires_at < ?`,
    args: [now],
  });
  const ids = r.rows.map((row) => row.id);
  for (const id of ids) {
    await deleteJob(id);
  }
  return ids.length;
}

module.exports = {
  getClient,
  ensureSchema,
  dbHealthy,
  genId,
  createJob,
  getJob,
  getSources,
  updateJob,
  updateSource,
  appendSourceChunk,
  readSourceBytes,
  storeOutput,
  streamOutput,
  getOutputSize,
  deleteJob,
  deleteSourceChunks,
  cleanupExpired,
};
