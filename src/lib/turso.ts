// src/lib/turso.ts — عميل Turso + إنشاء المخطط + عمليات المهام والمفاتيح
// عميل واحد عبر HTTP مناسب لـ Vercel serverless
import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

export function getDb(): Client {
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

// إنشاء المخطط عند أول وصول — لا حاجة لأداة migrations
export async function ensureSchema(): Promise<void> {
  const db = getDb();
  await db.batch([
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      provider TEXT,
      provider_task_id TEXT,
      key_id TEXT,
      model TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT DEFAULT '',
      params_json TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      result_urls_json TEXT,
      error_message TEXT,
      attempts_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT DEFAULT '',
      api_key TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      usage_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_keys_provider ON api_keys(provider)`,
    `CREATE INDEX IF NOT EXISTS idx_keys_status ON api_keys(status)`,
  ]);
}

export async function dbHealthy(): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute('SELECT 1 as ok');
    return true;
  } catch {
    return false;
  }
}

// ===== أنواع =====
export interface TaskRow {
  id: string;
  provider: string | null;
  provider_task_id: string | null;
  key_id: string | null;
  model: string;
  type: 'image' | 'video' | 'merge';
  prompt: string;
  params_json: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  result_urls_json: string | null;
  error_message: string | null;
  attempts_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ApiKeyRow {
  id: string;
  provider: 'kie' | 'cometapi';
  label: string;
  api_key: string;
  status: 'active' | 'exhausted' | 'disabled';
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface Attempt {
  provider: string;
  keyId: string;
  keyLabel: string;
  ok: boolean;
  errorClass?: string;
  error?: string;
  at: string;
}

// ===== عمليات المهام =====
import { randomUUID } from 'crypto';

export async function insertTask(input: {
  provider?: string;
  provider_task_id?: string;
  key_id?: string;
  model: string;
  type: TaskRow['type'];
  prompt?: string;
  params_json?: object;
  status?: TaskRow['status'];
}): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO tasks (id, provider, provider_task_id, key_id, model, type, prompt, params_json, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.provider || null,
      input.provider_task_id || null,
      input.key_id || null,
      input.model,
      input.type,
      input.prompt || '',
      JSON.stringify(input.params_json || {}),
      input.status || 'pending',
    ],
  });
  return id;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM tasks WHERE id = ?`, args: [id] });
  return (r.rows[0] as unknown as TaskRow) || null;
}

// patch جزئي: يضيف attempts ويضبط completed_at تلقائياً عند الاكتمال
export async function updateTask(id: string, patch: Partial<TaskRow> & { attempt?: Attempt }): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'attempt') continue;
    if (k === 'params_json' && typeof v === 'object') {
      sets.push(`${k} = ?`);
      args.push(JSON.stringify(v));
    } else if (k === 'result_urls_json' && Array.isArray(v)) {
      sets.push(`${k} = ?`);
      args.push(JSON.stringify(v));
    } else {
      sets.push(`${k} = ?`);
      args.push(v);
    }
  }
  // إضافة attempt لـ attempts_json
  if (patch.attempt) {
    const existing = await getTask(id);
    const attempts: Attempt[] = existing ? JSON.parse(existing.attempts_json || '[]') : [];
    attempts.push(patch.attempt);
    sets.push('attempts_json = ?');
    args.push(JSON.stringify(attempts));
  }
  // اضبط completed_at عند الاكتمال
  if (patch.status === 'completed' || patch.status === 'failed') {
    sets.push(`completed_at = datetime('now')`);
  }
  sets.push(`updated_at = datetime('now')`);
  args.push(id);
  await db.execute({ sql: `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, args });
}

export async function listRecentTasks(limit = 20, filter?: { type?: string; status?: string }): Promise<TaskRow[]> {
  const db = getDb();
  const conditions: string[] = [];
  const args: unknown[] = [];
  if (filter?.type) { conditions.push('type = ?'); args.push(filter.type); }
  if (filter?.status) { conditions.push('status = ?'); args.push(filter.status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  args.push(limit);
  const r = await db.execute({
    sql: `SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ?`,
    args,
  });
  return r.rows as unknown as TaskRow[];
}

export async function taskStats(): Promise<{ total: number; completed: number; failed: number; processing: number }> {
  const db = getDb();
  const r = await db.execute(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
    SUM(CASE WHEN status IN ('processing','pending') THEN 1 ELSE 0 END) as processing
    FROM tasks`);
  const row = r.rows[0] as any;
  return {
    total: Number(row?.total || 0),
    completed: Number(row?.completed || 0),
    failed: Number(row?.failed || 0),
    processing: Number(row?.processing || 0),
  };
}

// ===== عمليات المفاتيح =====
export async function getKeyPool(providers: string[]): Promise<ApiKeyRow[]> {
  const db = getDb();
  if (providers.length === 0) return [];
  const placeholders = providers.map(() => '?').join(',');
  const r = await db.execute({
    sql: `SELECT * FROM api_keys WHERE status != 'disabled' AND provider IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
    args: providers,
  });
  return r.rows as unknown as ApiKeyRow[];
}

export async function getAllKeys(): Promise<ApiKeyRow[]> {
  const db = getDb();
  const r = await db.execute(`SELECT * FROM api_keys ORDER BY created_at ASC, id ASC`);
  return r.rows as unknown as ApiKeyRow[];
}

export async function insertKey(input: { provider: string; api_key: string; label?: string }): Promise<string> {
  const db = getDb();
  // تحقق من عدم التكرار لنفس المزود
  const existing = await db.execute({
    sql: `SELECT id FROM api_keys WHERE provider = ? AND api_key = ?`,
    args: [input.provider, input.api_key],
  });
  if (existing.rows.length > 0) {
    throw new Error('المفتاح مضاف بالفعل لهذا المزود');
  }
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO api_keys (id, provider, label, api_key, status) VALUES (?, ?, ?, ?, 'active')`,
    args: [id, input.provider, input.label || '', input.api_key],
  });
  return id;
}

export async function updateKey(id: string, patch: Partial<ApiKeyRow>): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    args.push(v);
  }
  sets.push(`last_checked_at = datetime('now')`);
  args.push(id);
  await db.execute({ sql: `UPDATE api_keys SET ${sets.join(', ')} WHERE id = ?`, args });
}

export async function deleteKey(id: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM api_keys WHERE id = ?`, args: [id] });
}

export async function getKey(id: string): Promise<ApiKeyRow | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM api_keys WHERE id = ?`, args: [id] });
  return (r.rows[0] as unknown as ApiKeyRow) || null;
}

// إخفاء المفتاح دائمًا في الاستجابات
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 11) {
    return key.slice(0, 3) + '••••';
  }
  return key.slice(0, 7) + '••••••••' + key.slice(-4);
}
