# 🎬 موقع دمج الفيديوهات على Vercel

أداة مجانية لدمج عدة مقاطع في فيديو واحد عالي الجودة، مع واجهة برمجية عامة (API) للمطورين.

## المميزات

- ✅ دمج عدة مقاطع (حتى 10) بترتيب قابل لإعادة الترتيب
- ✅ دعم الروابط المباشرة + رفع الملفات من الجهاز
- ✅ ترميز عالي الجودة: H.264 CRF 18 + AAC 192k + faststart
- ✅ توحيد المصادر تلقائياً (scale+pad إلى أكبر دقة، fps=30، yuv420p)
- ✅ إضافة صوت صامت للمصادر بلا صوت
- ✅ واجهة عربية RTL حديثة بثيم داكن
- ✅ API عام بدون تسجيل دخول (CORS مفتوح)
- ✅ بث الفيديو بدعم HTTP Range
- ✅ حذف تلقائي بعد 24 ساعة
- ✅ تخزين كل البيانات في Turso (لا S3)

## التقنيات

- **Node.js** خالص (CommonJS) — لا Next.js ولا React
- **@libsql/client** — Turso عبر HTTP
- **ffmpeg-static** + **ffprobe-static** — معالجة الفيديو
- **Vercel Serverless Functions** — في `api/`

## النشر على Vercel

### 1) إنشاء قاعدة Turso

```bash
# ثبّت Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# سجّل الدخول
turso auth signup   # أو login

# أنشئ قاعدة
turso db create video-merger

# احصل على رابط الاتصال
turso db show video-merger --url
# يرجع: libsql://video-merger-<your-org>.turso.io

# أنشئ توكن
turso db tokens create video-merger
# يرجع: eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...
```

### 2) ربط المستودع بـ Vercel

```bash
# ثبّت Vercel CLI
npm i -g vercel

# انشر
vercel
```

### 3) متغيرات البيئة على Vercel

في Vercel → Settings → Environment Variables، أضف:

| المتغير | القيمة | إلزامي |
|---|---|---|
| `TURSO_DATABASE_URL` | `libsql://video-merger-<org>.turso.io` | ✅ |
| `TURSO_AUTH_TOKEN` | `<turso token>` | ✅ |
| `MAX_SOURCES` | `10` | افتراضي |
| `SOURCE_MAX_MB` | `200` | افتراضي |
| `OUTPUT_MAX_MB` | `150` | افتراضي |
| `MAX_TOTAL_DURATION_SEC` | `600` | افتراضي |
| `FFMPEG_PRESET` | `medium` | افتراضي |
| `UPLOAD_CHUNK_BYTES` | `4194304` | افتراضي |

بعد إضافة المتغيرات، انشر مجدداً: `vercel --prod`

## التشغيل محلياً

```bash
# ثبّت الحزم
npm install

# انسخ .env.example إلى .env واملأ بيانات Turso
cp .env.example .env

# شغّل خادم التطوير
npm run dev

# شغّل اختبارات الوحدة
npm run test:unit

# شغّل اختبارات HTTP (في نافذة منفصلة بعد npm run dev)
npm run test:http
```

## توثيق API

### `POST /api/jobs` — إنشاء مهمة دمج

**بـ روابط:**
```bash
curl -X POST https://your-app.vercel.app/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"videos":["https://example.com/a.mp4","https://example.com/b.mp4"]}'
```

**بـ ملفات مرفوعة:**
```bash
curl -X POST https://your-app.vercel.app/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"sources":[{"kind":"url","url":"https://..."},{"kind":"file","name":"local.mp4","size":12345,"mime":"video/mp4"}]}'
```

**الرد (201):**
```json
{
  "jobId": "abc123def456",
  "status": "queued",
  "statusUrl": "https://.../api/jobs/abc123def456",
  "processUrl": "https://.../api/jobs/abc123def456/process",
  "expiresAt": "2026-11-11T14:00:00.000Z"
}
```

### `POST /api/upload?job=<id>&seq=<n>&chunk=<k>` — رفع جزء ملف

```bash
curl -X POST "https://your-app.vercel.app/api/upload?job=abc123&seq=1&chunk=0" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @chunk.bin
```

كل جزء ≤ 4MB. أعد المحاولة 3 مرات عند الفشل.

### `POST /api/jobs/<id>/process` — تنفيذ الدمج

```bash
curl -X POST https://your-app.vercel.app/api/jobs/abc123def456/process
```

**الرد (200) — متزامن:**
```json
{
  "status": "done",
  "videoUrl": "https://.../api/jobs/abc123def456/video",
  "downloadUrl": "https://.../api/jobs/abc123def456/video?download=1",
  "size": 1234567,
  "duration": 30.2,
  "resolution": "640x360",
  "expiresAt": "2026-11-11T14:00:00.000Z"
}
```

إذا كانت المهمة قيد المعالجة فعلاً، يرجع `202`.

### `GET /api/jobs/<id>` — الحالة + التقدم

```bash
curl https://your-app.vercel.app/api/jobs/abc123def456
```

```json
{
  "jobId": "abc123def456",
  "status": "done",
  "progress": 100,
  "videoUrl": "...",
  "downloadUrl": "...",
  "size": 1234567,
  "duration": 30.2,
  "resolution": "640x360",
  "error": null,
  "createdAt": "...",
  "expiresAt": "..."
}
```

الحالات: `queued` → (`uploading`) → `processing` → `done` | `failed`

### `GET /api/jobs/<id>/video` — بث الناتج (يدعم Range)

```bash
# بث كامل
curl https://your-app.vercel.app/api/jobs/abc123def456/video -o merged.mp4

# بث جزئي (206 Partial Content)
curl -r 0-1048575 https://your-app.vercel.app/api/jobs/abc123def456/video -o part.mp4

# تحميل مباشر
curl -L https://your-app.vercel.app/api/jobs/abc123def456/video?download=1 -o merged.mp4
```

### `DELETE /api/jobs/<id>` — حذف فوري شامل

```bash
curl -X DELETE https://your-app.vercel.app/api/jobs/abc123def456
```

### `GET /api/config` — الحدود العامة

```bash
curl https://your-app.vercel.app/api/config
```

```json
{
  "version": "1.0.0",
  "maxSources": 10,
  "sourceMaxMb": 200,
  "outputMaxMb": 150,
  "maxTotalDurationSec": 600,
  "uploadChunkBytes": 4194304,
  "expiresHours": 24,
  "output": {"codec": "h264", "audio": "aac", "container": "mp4", "crf": 18, "preset": "medium"},
  "database": "turso-connected"
}
```

### `GET /api/cron` — تنظيف المهام المنتهية

يُستدعى يومياً عبر `vercel.json` crons. يمكن استدعاؤه يدوياً:
```bash
curl https://your-app.vercel.app/api/cron
```

## حدود الخطة المجانية (Vercel + Turso)

| المورد | الحد على Hobby | ملاحظة |
|---|---|---|
| مدة دالة Vercel | 60s (افتراضي) / 300s (في `vercel.json`) | الدوال الثقيلة قد تحتاج Pro |
| حجم الطلب | ~4.5MB | لذلك الرفع مجزأ 4MB |
| حجم Vercel Function | 50MB | `ffmpeg-static` ~80MB — قد يتجاوز |
| تخزين Turso (Free) | 9GB | كافٍ للتجربة |
| قراءات Turso (Free) | 1B صف/شهر | كافٍ |
| كتابات Turso (Free) | 25M صف/شهر | كافٍ |
| Cron Vercel (Hobby) | مرة/يوم | كافٍ للتنظيف |

**ملاحظة حول ffmpeg-static على Vercel:** الحجم ~80MB وقد يتجاوز حد 250MB للدالة. الحلول:
1. استخدم Pro plan (أو Crew)
2. أو حمّل ffmpeg binary من CDN عند بدء التشغيل إلى `/tmp`
3. أو استخدم layer مخصص

## هيكل المشروع

```
video-merger/
├── api/
│   ├── jobs.js              # POST: إنشاء مهمة
│   ├── upload.js            # POST: رفع جزء ملف
│   ├── config.js            # GET: الحدود
│   ├── cron.js              # GET: تنظيف
│   └── jobs/[id]/
│       ├── index.js         # GET/DELETE: الحالة/الحذف
│       ├── process.js       # POST: تنفيذ الدمج
│       └── video.js         # GET: بث الناتج
├── lib/
│   ├── db.js                # Turso + المخطط + العمليات
│   ├── storage.js           # تخزين مجزأ
│   ├── merger.js            # ffmpeg: probe + filter_complex + concat
│   ├── http.js              # أدوات HTTP مشتركة
│   ├── config.js            # الحدود
│   └── utils.js             # أدوات مساعدة
├── public/
│   └── index.html           # الواجهة العربية RTL
├── scripts/
│   ├── dev.js               # خادم تطوير محلي
│   ├── test.js              # اختبارات وحدة
│   └── http-test.js         # اختبارات HTTP
├── .env.example
├── .gitignore
├── vercel.json
├── package.json
└── README.md
```

## الاختبارات

```bash
npm run test:unit    # 15 اختبار وحدة (توليد، دمج، تخزين، استرجاع، حذف)
npm run test:http    # 13 اختبار HTTP (config, jobs, upload, process, video, delete)
```

## الترخيص

MIT
