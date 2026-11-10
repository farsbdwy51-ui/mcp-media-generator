'use client';

import { useEffect, useState, useCallback } from 'react';

// ===== أنواع =====
interface ApiKey {
  id: string;
  provider: 'kie' | 'cometapi';
  label: string;
  api_key: string; // مقنّع
  status: 'active' | 'exhausted' | 'disabled';
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface Task {
  id: string;
  provider: string | null;
  model: string;
  type: 'image' | 'video' | 'merge';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  prompt: string;
  result_urls_json: string | null;
  error_message: string | null;
  attempts_json: string;
  created_at: string;
}

interface Stats {
  total: number;
  completed: number;
  failed: number;
  processing: number;
}

interface Health {
  ok: boolean;
  database: string;
  mcpEndpoint: string;
  models: { canonical: string; type: string; providers: string[] }[];
  merger: { base: string; healthy: boolean };
  authRequired: boolean;
}

// ===== مكونات مساعدة =====
function Badge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 border-green-300',
    exhausted: 'bg-amber-100 text-amber-700 border-amber-300',
    disabled: 'bg-gray-200 text-gray-600 border-gray-400',
    completed: 'bg-green-100 text-green-700 border-green-300',
    failed: 'bg-red-100 text-red-700 border-red-300',
    processing: 'bg-blue-100 text-blue-700 border-blue-300',
    pending: 'bg-amber-100 text-amber-700 border-amber-300',
  };
  const cls = colors[status] || 'bg-gray-100 text-gray-600 border-gray-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold border ${cls}`}>
      {status}
    </span>
  );
}

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm">
      <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
        <span className="w-7 h-7 flex items-center justify-center rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 text-white text-sm">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </div>
  );
}

// ===== الصفحة =====
export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, completed: 0, failed: 0, processing: 0 });
  const [origin, setOrigin] = useState('');
  const [tab, setTab] = useState<'chatgpt' | 'claude' | 'cursor'>('chatgpt');
  const [newKey, setNewKey] = useState({ provider: 'kie', api_key: '', label: '' });
  const [msg, setMsg] = useState('');

  // جلب البيانات
  const refresh = useCallback(async () => {
    try {
      const [h, k, t] = await Promise.all([
        fetch('/api/health').then(r => r.json()),
        fetch('/api/keys').then(r => r.json()),
        fetch('/api/tasks?limit=20').then(r => r.json()),
      ]);
      setHealth(h);
      setKeys(k.keys || []);
      setTasks(t.tasks || []);
      setStats(t.stats || { total: 0, completed: 0, failed: 0, processing: 0 });
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    setOrigin(window.location.origin);
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, [refresh]);

  // إضافة مفتاح
  async function addKey() {
    if (!newKey.api_key.trim()) { setMsg('❌ المفتاح مطلوب'); return; }
    try {
      const r = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newKey),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsg('✅ تمت الإضافة');
      setNewKey({ provider: 'kie', api_key: '', label: '' });
      refresh();
    } catch (e: any) { setMsg('❌ ' + e.message); }
  }

  // تعطيل/تنشيط
  async function toggleKey(id: string, currentStatus: string) {
    const newStatus = currentStatus === 'disabled' ? 'active' : 'disabled';
    await fetch(`/api/keys/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    refresh();
  }

  // حذف
  async function deleteKey(id: string) {
    if (!confirm('تأكيد الحذف؟')) return;
    await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    refresh();
  }

  const mcpUrl = `${origin}/mcp`;
  const authHeader = health?.authRequired ? `\n  "headers": { "Authorization": "Bearer ${process.env.NEXT_PUBLIC_MCP_TOKEN || '<TOKEN>'}" }` : '';

  const configs = {
    chatgpt: JSON.stringify({
      mcpServers: {
        'media-generator': {
          url: mcpUrl,
          ...(health?.authRequired ? { headers: { Authorization: 'Bearer <TOKEN>' } } : {}),
        },
      },
    }, null, 2),
    claude: JSON.stringify({
      mcpServers: {
        'media-generator': {
          type: 'http',
          url: mcpUrl,
          ...(health?.authRequired ? { headers: { Authorization: 'Bearer <TOKEN>' } } : {}),
        },
      },
    }, null, 2),
    cursor: JSON.stringify({
      mcpServers: {
        'media-generator': {
          url: mcpUrl,
          ...(health?.authRequired ? { headers: { Authorization: 'Bearer <TOKEN>' } } : {}),
        },
      },
    }, null, 2),
  };

  const toolsInfo = [
    { name: 'generate_image', desc: 'توليد صورة بـ gpt-image-2-6/flare-text-to-image' },
    { name: 'generate_video', desc: 'توليد فيديو بـ grok-imagine-video-1-5-preview مع صوت متزامن' },
    { name: 'merge_videos', desc: 'دمج عدة مقاطع في فيديو واحد بالترتيب' },
    { name: 'get_task', desc: 'تتبع حالة أي مهمة بمعرّفها كل ~10 ثوانٍ' },
    { name: 'list_media', desc: 'استرجاع أحدث الوسائط المخزنة من قاعدة البيانات' },
  ];

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* الهيدر */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-500 to-blue-600 bg-clip-text text-transparent">
            🎬 مولّد الوسائط MCP
          </h1>
          <div className="flex items-center gap-2 text-sm">
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border ${health?.ok ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
              <span className={`w-2 h-2 rounded-full ${health?.ok ? 'bg-green-500' : 'bg-red-500'}`}></span>
              {health?.ok ? 'Turso متصل' : 'غير متصل'}
            </span>
            {health?.merger && (
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border ${health.merger.healthy ? 'bg-green-50 text-green-700 border-green-300' : 'bg-amber-50 text-amber-700 border-amber-300'}`}>
                <span className={`w-2 h-2 rounded-full ${health.merger.healthy ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                خدمة الدمج {health.merger.healthy ? 'متاحة' : 'غير متاحة'}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* إحصائيات */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { lbl: 'إجمالي', val: stats.total, color: 'text-zinc-700 dark:text-zinc-300' },
            { lbl: 'مكتملة', val: stats.completed, color: 'text-green-600' },
            { lbl: 'فاشلة', val: stats.failed, color: 'text-red-600' },
            { lbl: 'جارية', val: stats.processing, color: 'text-blue-600' },
          ].map((s, i) => (
            <div key={i} className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 text-center">
              <div className={`text-3xl font-bold ${s.color}`}>{s.val}</div>
              <div className="text-xs text-zinc-500 mt-1">{s.lbl}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* مدير المفاتيح */}
          <Card title="مدير المفاتيح" icon="🔑">
            <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 border border-amber-300 dark:border-amber-800 rounded p-2 mb-3">
              أضف عدة مفاتيح لكل مزود — التجربة تسلسلية (أول مفتاح ثم التالي ثم التالي) مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد دون توقف.
            </p>
            <div className="space-y-2 mb-3">
              <select
                value={newKey.provider}
                onChange={(e) => setNewKey({ ...newKey, provider: e.target.value as any })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
              >
                <option value="kie">kie.ai</option>
                <option value="cometapi">CometAPI</option>
              </select>
              <input
                type="text"
                placeholder="تسمية اختيارية (مثل: حساب العمل)"
                value={newKey.label}
                onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm"
              />
              <input
                type="text"
                placeholder="المفتاح (Bearer token)"
                value={newKey.api_key}
                onChange={(e) => setNewKey({ ...newKey, api_key: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-mono"
              />
              <button onClick={addKey} className="w-full px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm hover:opacity-90">
                + إضافة مفتاح
              </button>
            </div>
            {msg && <div className="text-xs mb-2">{msg}</div>}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {keys.length === 0 && <div className="text-center text-zinc-500 text-sm py-4">لا توجد مفاتيح بعد</div>}
              {keys.map((k) => (
                <div key={k.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 text-xs">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="font-mono text-zinc-700 dark:text-zinc-300 text-[11px]">{k.api_key}</div>
                    <Badge status={k.status} />
                  </div>
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>{k.provider} {k.label && `· ${k.label}`}</span>
                    <span>استخدام: {k.usage_count} | نجاح: {k.success_count} | فشل: {k.fail_count}</span>
                  </div>
                  {k.last_error && <div className="text-red-500 mt-1 text-[10px]">آخر خطأ: {k.last_error.slice(0, 100)}</div>}
                  <div className="flex gap-1 mt-2">
                    <button onClick={() => toggleKey(k.id, k.status)} className="px-2 py-1 rounded text-[11px] bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                      {k.status === 'disabled' ? 'تنشيط' : 'تعطيل'}
                    </button>
                    <button onClick={() => deleteKey(k.id)} className="px-2 py-1 rounded text-[11px] bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/40">
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* لوحة المهام */}
          <Card title="لوحة المهام" icon="📋">
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {tasks.length === 0 && <div className="text-center text-zinc-500 text-sm py-4">لا توجد مهام بعد</div>}
              {tasks.map((t) => {
                let urls: string[] = [];
                try { urls = JSON.parse(t.result_urls_json || '[]'); } catch {}
                return (
                  <div key={t.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 text-xs">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold">{t.type === 'image' ? '🖼️' : t.type === 'video' ? '🎬' : '🔀'} {t.model}</span>
                      <Badge status={t.status} />
                    </div>
                    <div className="text-zinc-500 text-[11px] mb-1">{t.prompt.slice(0, 80)}{t.prompt.length > 80 ? '…' : ''}</div>
                    {(t.status === 'processing' || t.status === 'pending') && (
                      <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-1.5 mb-1">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${t.progress}%` }}></div>
                      </div>
                    )}
                    {t.error_message && <div className="text-red-500 text-[10px]">⚠️ {t.error_message.slice(0, 100)}</div>}
                    {urls.length > 0 && (
                      <a href={urls[0]} target="_blank" rel="noreferrer" className="inline-block mt-1 px-2 py-1 rounded bg-green-50 text-green-700 text-[11px] hover:bg-green-100">
                        فتح الرابط ↗
                      </a>
                    )}
                    <div className="text-zinc-400 text-[10px] mt-1">{new Date(t.created_at + 'Z').toLocaleString('ar-EG')}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ربط السيرفر */}
        <Card title="ربط السيرفر" icon="🔗">
          <div className="mb-3">
            <label className="text-xs text-zinc-500 block mb-1">رابط MCP (انسخه)</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={mcpUrl}
                className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-mono"
              />
              <button onClick={() => { navigator.clipboard.writeText(mcpUrl); }} className="px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm">
                📋 نسخ
              </button>
            </div>
          </div>
          <div className="text-xs text-zinc-500 mb-2">
            في ChatGPT: Settings → Connectors → Create → Custom MCP server وضع الرابط في «Server URL».
          </div>
          <div className="flex gap-1 mb-2">
            {(['chatgpt', 'claude', 'cursor'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab === t ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
                {t === 'chatgpt' ? 'ChatGPT / GPT Agents' : t === 'claude' ? 'Claude Desktop' : 'Cursor / Windsurf / Cline'}
              </button>
            ))}
          </div>
          <pre dir="ltr" className="bg-zinc-900 text-zinc-100 rounded-lg p-3 text-[11px] overflow-x-auto max-h-48 overflow-y-auto font-mono">
{configs[tab]}
          </pre>
          <div className="mt-3">
            <div className="text-xs font-semibold mb-2">الأدوات الخمس:</div>
            <div className="flex flex-wrap gap-2">
              {toolsInfo.map(t => (
                <div key={t.name} className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-[11px]">
                  <span className="font-mono font-semibold">{t.name}</span>
                  <span className="text-zinc-500 block">{t.desc}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs">
            ⚠️ الفيديو يحتاج دقائق: يعيد السيرفر task_id فورًا، ويتابَع تلقائيًا بـ get_task كل 10 ثوانٍ — وعند اكتمال المهمة يُعرض الرابط في الدردشة ويتوقف. أثناء الانتظار يُبَث تقدم حي (Progress notifications) حتى لا تنقطع العملية.
          </div>
        </Card>

        {/* الموديلات */}
        {health?.models && (
          <Card title="الموديلات المدمجة" icon="🧠">
            <div className="space-y-2">
              {health.models.map(m => (
                <div key={m.canonical} className="flex items-center justify-between border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 text-xs">
                  <span className="font-mono">{m.canonical}</span>
                  <span className="text-zinc-500">{m.type} · {m.providers.join(', ')}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <footer className="text-center py-6 text-xs text-zinc-500">
        مولّد الوسائط MCP © 2026 — يعمل على Next.js مع Turso و MCP SDK
      </footer>
    </main>
  );
}
