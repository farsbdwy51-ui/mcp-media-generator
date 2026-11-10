# 🎬 MCP Media Generator — خادم MCP لتوليد الصور والفيديو

خادم MCP (Model Context Protocol) يجمع ثلاث قدرات في أداة واحدة:
1. **توليد صور** بـ `gpt-image-2-6/flare-text-to-image` (kie.ai + CometAPI)
2. **توليد فيديو** بـ `grok-imagine-video-1-5-preview` (صوت متزامن أصلي)
3. **دمج عدة مقاطع** في فيديو واحد نهائي عالي الجودة

## المميزات

- ✅ **خادم MCP** على المسار `/mcp` (نقل Streamable HTTP)
- ✅ **5 أدوات**: `generate_image`, `generate_video`, `merge_videos`, `get_task`, `list_media`
- ✅ **تبديل تلقائي للمفاتيح** بالترتيب التسلسلي عند أي خطأ أو نفاد رصيد
- ✅ **صمت كامل** للنموذج عن أخطاء المفاتيح/الرصيد — التبديل يتم تلقائياً بنفس `task_id`
- ✅ **مزودان**: kie.ai (أساسي) + CometAPI (احتياطي)
- ✅ **دمج الفيديوهات** عبر خدمة دمج خارجية (مشروع video-merger)
- ✅ **واجهة عربية RTL** لإدارة المفاتيح والمهام وعرض رابط الربط
- ✅ **إخفاء المفاتيح** إلزامياً في كل الاستجابات والسجلات
- ✅ **حذف تلقائي** لملفات الدمج بعد 24 ساعة

## التقنيات

- **Next.js** (App Router) + **TypeScript** + **Tailwind CSS**
- **`@modelcontextprotocol/sdk`** — SDK الرسمي
- **`@libsql/client`** — Turso عبر HTTP (مناسب لـ Vercel)
- **shadcn/ui** — مكونات الواجهة

## النشر على Vercel

### 1) متغيرات البيئة على Vercel

في Vercel → Settings → Environment Variables:

| المتغير | القيمة | إلزامي |
|---|---|---|
| `TURSO_DATABASE_URL` | `libsql://your-db.turso.io` | ✅ |
| `TURSO_AUTH_TOKEN` | `<turso token>` | ✅ |
| `MERGER_API_BASE` | `https://your-merger.vercel.app` | ✅ |
| `MCP_ACCESS_TOKEN` | (اختياري) حماية `/mcp` بـ Bearer | ❌ |
| `KIE_IMAGE_MODEL` | تجاوز اسم الموديل | ❌ |
| `KIE_VIDEO_MODEL` | تجاوز اسم الموديل | ❌ |
| `COMETAPI_IMAGE_MODEL` | تجاوز اسم الموديل | ❌ |
| `COMETAPI_VIDEO_MODEL` | تجاوز اسم الموديل | ❌ |
| `COMETAPI_BASE` | تجاوز عنوان CometAPI | ❌ |

> **ملاحظة:** يجب نشر مشروع [video-merger](../video-merger/) أولاً ووضع رابطه في `MERGER_API_BASE`.

### 2) النشر

```bash
vercel --prod
```

## الربط مع عملاء MCP

### ChatGPT / GPT Agents
Settings → Connectors → Create → Custom MCP server
- Server URL: `https://your-app.vercel.app/mcp`
- (إن ضُبط `MCP_ACCESS_TOKEN`) أضف Header: `Authorization: Bearer <token>`

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "media-generator": {
      "type": "http",
      "url": "https://your-app.vercel.app/mcp"
    }
  }
}
```

### Cursor / Windsurf / Cline (`mcp.json`)
```json
{
  "mcpServers": {
    "media-generator": {
      "url": "https://your-app.vercel.app/mcp"
    }
  }
}
```

## الأدوات الخمس

### `generate_image`
توليد صورة بـ `gpt-image-2-6/flare-text-to-image`.
```json
{
  "prompt": "What to draw",
  "model": "gpt-image-2-6/flare-text-to-image",
  "aspect_ratio": "16:9",
  "resolution": "1K",
  "background": "auto",
  "output_format": "png",
  "wait_seconds": 90
}
```

### `generate_video`
توليد فيديو بـ `grok-imagine-video-1-5-preview` (صوت متزامن أصلي).
```json
{
  "prompt": "Scene description",
  "image_url": "https://... (optional, image-to-video)",
  "model": "grok-imagine-video-1-5-preview",
  "aspect_ratio": "16:9",
  "resolution": "480p",
  "enable_audio": true,
  "duration": 8,
  "wait_seconds": 25
}
```

### `merge_videos`
دمج عدة مقاطع في فيديو واحد بالترتيب.
```json
{
  "urls": ["https://...clip1.mp4", "https://...clip2.mp4"],
  "task_ids": ["uuid1", "uuid2"],
  "wait_seconds": 60
}
```

### `get_task`
تتبع أي مهمة بمعرّفها كل ~10 ثوانٍ.
```json
{ "task_id": "uuid" }
```

### `list_media`
استرجاع أحدث الوسائط المخزنة.
```json
{ "type": "image|video|merge", "status": "completed|failed|processing", "limit": 10 }
```

## سلوك التبديل التسلسلي

1. **الترتيب الصارم:** `getKeyPool` يجلب كل المفاتيح غير المعطّلة بترتيب `created_at ASC, id ASC` — أول مفتاح أُضيف يُجرَّب أولاً.
2. **لا توقف أبدًا:** عند فشل مفتاح (نفاد رصيد/خطأ/محدودية)، يُبدَّل تلقائياً للمفتاح التالي ويُستأنف نفس المهمة بنفس `task_id`.
3. **صمت كامل:** النموذج لا يرى أي خطأ مفتاح/رصيد أبداً — التبديل صامت تماماً.
4. **بانتظار توفر مفتاح:** إذا فشلت كل المفاتيح، تبقى المهمة `processing` وتُعاد محاولتها مع كل `get_task` (بتهدئة ~45 ثانية).
5. **تصنيف الأخطاء:** `disabled` (401/403) → تعطيل المفتاح؛ `exhausted` (402/أنماط الرصيد) → تمييز كـ exhausted؛ `params` (400/422) → توقف فوري؛ `temporary` (429/5xx) → انتقل للتالي.

## هيكل المشروع

```
src/
├── app/
│   ├── layout.tsx              # RTL عربي
│   ├── page.tsx                # لوحة الإدارة العربية
│   ├── mcp/
│   │   └── route.ts            # خادم MCP على /mcp
│   └── api/
│       ├── health/route.ts     # فحص الصحة
│       ├── keys/route.ts       # إدارة المفاتيح
│       ├── keys/[id]/route.ts  # تعطيل/تنشيط/حذف
│       └── tasks/route.ts      # قائمة المهام للواجهة
├── lib/
│   ├── turso.ts                # عميل Turso + المخطط + العمليات
│   ├── models.ts               # سجل الموديلات
│   ├── errors.ts               # تصنيف أخطاء المزودين
│   ├── generation.ts           # منسّق التوليد بالتبديل التسلسلي
│   ├── merger.ts               # عميل خدمة الدمج v2
│   ├── mcp-tools.ts            # تعريفات الأدوات الخمس وأدوات التنفيذ
│   └── providers/
│       ├── types.ts            # واجهة المزودات
│       ├── kie.ts              # مزود kie.ai
│       ├── cometapi.ts         # مزود CometAPI
│       └── index.ts            # سجل المزودات
└── ...
```

## التشغيل محلياً

```bash
# انسخ .env.example إلى .env.local واملأ بيانات Turso و MERGER_API_BASE
# ثبّت الحزم (تُثبَّت تلقائياً في بيئة fullstack-dev)
bun run dev  # أو npm run dev

# فحص الصحة
curl http://localhost:3000/api/health
```

## اختبار MCP بـ curl

```bash
# تهيئة جلسة
SESSION=$(curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  -D - | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r\n')
echo "Session: $SESSION"

# قائمة الأدوات
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# استدعاء أداة
curl -s -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_media","arguments":{}}}'
```

## الترخيص

MIT
