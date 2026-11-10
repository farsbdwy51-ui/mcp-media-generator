// src/lib/mcp-tools.ts — تعريفات الأدوات الخمس وأدوات التنفيذ
import { runGeneration, refreshTask } from './generation';
import { getTask, listRecentTasks, updateTask, insertTask, getDb } from './turso';
import { resolveModel, getMergeModel } from './models';
import { createMergeJob, processMergeJob, getMergeStatus, parseMergeStatus, normalizeProgress } from './merger';

// وصف الأدوات للـ MCP (يقرأها العميل)
export const TOOL_DEFINITIONS = [
  {
    name: 'generate_image',
    description: 'توليد صورة بـ gpt-image-2-6/flare-text-to-image (تبديل تلقائي عبر كل المفاتيح النشطة). تعيد رابط الصورة جاهزًا إذا اكتملت خلال نافذة الانتظار، وإلا تعيد task_id — استدعِ get_task كل ~10 ثوانٍ حتى completed ثم اعرض الرابط وتوقف.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, description: 'What to draw. Detailed prompts give better results.' },
        model: { type: 'string', enum: ['gpt-image-2-6/flare-text-to-image', 'gpt-image-2.6/flare-text-to-image'], default: 'gpt-image-2-6/flare-text-to-image' },
        aspect_ratio: { type: 'string', enum: ['auto','1:1','3:2','2:3','4:3','3:4','5:4','4:5','16:9','9:16','2:1','1:2','21:9','9:21','3:1','1:3'], default: 'auto' },
        resolution: { type: 'string', enum: ['1K','2K','4K'], default: '1K' },
        background: { type: 'string', enum: ['auto','transparent','opaque'], default: 'auto', description: 'Only applied at 1K.' },
        output_format: { type: 'string', enum: ['png','jpeg','webp','gif'], default: 'png' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: 240, default: 90 },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: 'توليد فيديو بـ grok-imagine-video-1-5-preview (صوت متزامن أصلي، image-to-video اختياري). الفيديو يحتاج دقائق: انتظار قصير مع بث تقدم ثم task_id — تابع بـ get_task كل ~10 ثوانٍ.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', maxLength: 4096, description: 'Scene description. Dialogue in the prompt is spoken in the video.' },
        image_url: { type: 'string', description: 'Optional public image URL as the first frame (image-to-video).' },
        model: { type: 'string', enum: ['grok-imagine-video-1-5-preview', 'grok-imagine-video-1.5-preview'], default: 'grok-imagine-video-1-5-preview' },
        aspect_ratio: { type: 'string', enum: ['auto','1:1','16:9','9:16','3:2','2:3'], default: 'auto' },
        resolution: { type: 'string', enum: ['480p','720p','1080p'], default: '480p' },
        enable_audio: { type: 'boolean', default: true },
        duration: { type: 'integer', minimum: 1, maximum: 15, default: 8, description: 'Duration in seconds.' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: 240, default: 25 },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'merge_videos',
    description: 'دمج عدة مقاطع في فيديو واحد نهائي بالترتيب المعطى. مرر urls (روابط فيديو مباشرة عامة — مثل روابط generate_video) أو task_ids (لمهام فيديو مكتملة تُحل روابطها من قاعدة البيانات بالترتيب — مثالي بعد توليد عدة مقاطع). الدمج سريع عادةً: انتظار قصير مع بث تقدم ثم task_id للدمج — تابعه بـ get_task. the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 10, description: 'Public direct video URLs (http/https) in merge order — the first clip starts the final video.' },
        task_ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 10, description: 'Alternative to urls: task_ids of COMPLETED video generation tasks — their result URLs are merged in this order.' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: 240, default: 60 },
      },
    },
  },
  {
    name: 'get_task',
    description: 'تتبع أي مهمة بمعرّفها — توليد صور/فيديو ودمج (يقرأ قاعدة Turso ويحدّث من المزود/الخدمة إن كانت جارية). استعلمه كل ~10 ثوانٍ؛ عند completed ستجد روابط النتائج — اعرضها للمستخدم وتوقف عن الاستعلام.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_media',
    description: 'أحدث الصور/الفيديوهات/الدمجات المخزنة بروابطها من قاعدة البيانات (بدون إعادة توليد) — لاسترجاع نتائج سابقة.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['image','video','merge'] },
        status: { type: 'string', enum: ['completed','failed','processing'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
];

// تنفيذ أداة generate_image
async function handleGenerateImage(args: any): Promise<{ content: any[]; isError?: boolean }> {
  const result = await runGeneration({
    prompt: args.prompt,
    modelName: args.model || 'gpt-image-2-6/flare-text-to-image',
    type: 'image',
    input: {
      prompt: args.prompt,
      model: args.model || 'gpt-image-2-6/flare-text-to-image',
      aspect_ratio: args.aspect_ratio || 'auto',
      resolution: args.resolution || '1K',
      background: args.background || 'auto',
      output_format: args.output_format || 'png',
    },
    waitSeconds: args.wait_seconds ?? 90,
  });

  if (result.status === 'failed') {
    return { content: [{ type: 'text', text: `❌ فشلت المهمة: ${result.error}` }], isError: true };
  }
  if (result.status === 'completed' && result.urls) {
    const url = result.urls[0];
    return {
      content: [
        { type: 'text', text: `✅ تم توليد الصورة بنجاح\n\n![image](${url})\n\nالرابط المباشر: ${url}` },
      ],
    };
  }
  // processing
  return {
    content: [
      { type: 'text', text: `⏳ المهمة قيد المعالجة — task_id: ${result.taskId}\n\nتابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.` },
    ],
  };
}

// تنفيذ أداة generate_video
async function handleGenerateVideo(args: any): Promise<{ content: any[]; isError?: boolean }> {
  const result = await runGeneration({
    prompt: args.prompt,
    modelName: args.model || 'grok-imagine-video-1-5-preview',
    type: 'video',
    input: {
      prompt: args.prompt,
      model: args.model || 'grok-imagine-video-1-5-preview',
      image_url: args.image_url,
      aspect_ratio: args.aspect_ratio || 'auto',
      resolution: args.resolution || '480p',
      enable_audio: args.enable_audio !== false,
      duration: args.duration || 8,
    },
    waitSeconds: args.wait_seconds ?? 25,
  });

  if (result.status === 'failed') {
    return { content: [{ type: 'text', text: `❌ فشلت المهمة: ${result.error}` }], isError: true };
  }
  if (result.status === 'completed' && result.urls) {
    const urls = result.urls.map((u, i) => `الرابط ${i + 1}: ${u}`).join('\n');
    return {
      content: [
        { type: 'text', text: `✅ تم توليد الفيديو بنجاح\n\n${urls}` },
      ],
    };
  }
  return {
    content: [
      { type: 'text', text: `⏳ المهمة قيد المعالجة — task_id: ${result.taskId}\n\nتابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.` },
    ],
  };
}

// تنفيذ أداة merge_videos
async function handleMergeVideos(args: any): Promise<{ content: any[]; isError?: boolean }> {
  let urls: string[] = [];
  // task_ids أُولًا ثم urls
  if (Array.isArray(args.task_ids) && args.task_ids.length > 0) {
    for (const tid of args.task_ids) {
      const t = await getTask(tid);
      if (!t || t.type !== 'video' || t.status !== 'completed') {
        return {
          content: [{ type: 'text', text: `❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة.\n\nالمهمة ${tid} غير موجودة أو ليست فيديو مكتمل.` }],
          isError: true,
        };
      }
      const u = JSON.parse(t.result_urls_json || '[]');
      if (Array.isArray(u) && u.length > 0) urls.push(u[0]);
    }
  }
  if (Array.isArray(args.urls) && args.urls.length > 0) {
    urls.push(...args.urls);
  }
  // تحقق صارم
  if (urls.length < 2) {
    return {
      content: [{ type: 'text', text: `❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة.` }],
      isError: true,
    };
  }
  if (urls.length > 10) {
    return {
      content: [{ type: 'text', text: `❌ أقصى عدد مقاطع للدمج هو 10 (خدمة الدمج تقبل 10 مقاطع كحد أقصى).` }],
      isError: true,
    };
  }
  // تحقق أن كل الروابط http/https
  for (const u of urls) {
    if (!/^https?:\/\//i.test(u)) {
      return { content: [{ type: 'text', text: `❌ رابط غير صالح: ${u}` }], isError: true };
    }
  }

  // سجّل مهمة الدمج في Turso
  const taskId = await insertTask({
    model: getMergeModel(),
    type: 'merge',
    prompt: `دمج ${urls.length} مقاطع`,
    params_json: { urls },
    status: 'processing',
  });

  try {
    // إنشاء مهمة في خدمة الدمج
    const job = await createMergeJob(urls);
    await updateTask(taskId, {
      provider: 'merger',
      provider_task_id: job.jobId,
    });

    // تنفيذ الدمج
    const waitSeconds = args.wait_seconds ?? 60;
    const deadline = Date.now() + waitSeconds * 1000;
    // شغّل process في الخلفية
    processMergeJob(job.jobId).catch(() => {});

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const st = await getMergeStatus(job.jobId);
        const parsed = parseMergeStatus(st.status);
        const pct = normalizeProgress(st.progress);
        await updateTask(taskId, { progress: pct });
        if (parsed === 'completed' && st.videoUrl) {
          await updateTask(taskId, {
            status: 'completed',
            progress: 100,
            result_urls_json: [st.videoUrl] as any,
          });
          return {
            content: [
              { type: 'text', text: `✅ تم دمج المقاطع بنجاح\n\nالرابط المباشر: ${st.videoUrl}\n\n⚠️ ملف الدمج يُحذف من خدمة الدمج بعد ~24 ساعة — شاهده/نزّله سريعًا.` },
            ],
          };
        }
        if (parsed === 'failed') {
          await updateTask(taskId, { status: 'failed', error: st.error || 'فشل الدمج' });
          return { content: [{ type: 'text', text: `❌ فشلت المهمة: ${st.error || 'فشل الدمج'}` }], isError: true };
        }
      } catch (e: any) {
        // خطأ شبكة — استمر بالاستعلام حتى انتهاء النافذة
      }
    }

    // انتهت النافذة — تبقى processing
    return {
      content: [
        { type: 'text', text: `⏳ المهمة قيد المعالجة — task_id: ${taskId}\n\nتابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.` },
      ],
    };
  } catch (e: any) {
    await updateTask(taskId, { status: 'failed', error: e.message });
    return { content: [{ type: 'text', text: `❌ فشلت المهمة: ${e.message}` }], isError: true };
  }
}

// تنفيذ أداة get_task
async function handleGetTask(args: any): Promise<{ content: any[]; isError?: boolean }> {
  const { task_id } = args;
  if (!task_id) {
    return { content: [{ type: 'text', text: '❌ task_id مطلوب' }], isError: true };
  }

  const task = await getTask(task_id);
  if (!task) {
    return { content: [{ type: 'text', text: `❌ المهمة غير موجودة: ${task_id}` }], isError: true };
  }

  // إن كانت مهمة دمج جارية — حدّث من خدمة الدمج
  if (task.type === 'merge' && task.status === 'processing' && task.provider_task_id) {
    try {
      const st = await getMergeStatus(task.provider_task_id);
      const parsed = parseMergeStatus(st.status);
      const pct = normalizeProgress(st.progress);
      await updateTask(task_id, { progress: pct });
      if (parsed === 'completed' && st.videoUrl) {
        await updateTask(task_id, {
          status: 'completed',
          progress: 100,
          result_urls_json: [st.videoUrl] as any,
        });
      } else if (parsed === 'failed') {
        await updateTask(task_id, { status: 'failed', error: st.error || 'فشل الدمج' });
      }
    } catch (e: any) {
      if (e.message.includes('غير موجودة')) {
        await updateTask(task_id, { status: 'failed', error: e.message });
      }
    }
  } else if (task.status === 'processing' && task.type !== 'merge') {
    // مهمة توليد جارية — حدّث من المزود
    await refreshTask(task_id);
  }

  // اقرأ المهمة المحدّثة
  const updated = await getTask(task_id);
  if (!updated) {
    return { content: [{ type: 'text', text: `❌ المهمة غير موجودة بعد التحديث` }], isError: true };
  }

  if (updated.status === 'completed') {
    const urls: string[] = JSON.parse(updated.result_urls_json || '[]');
    if (updated.type === 'image') {
      const url = urls[0];
      return {
        content: [{ type: 'text', text: `✅ تم توليد الصورة بنجاح\n\n![image](${url})\n\nالرابط المباشر: ${url}` }],
      };
    }
    if (updated.type === 'video') {
      const txt = urls.map((u, i) => `الرابط ${i + 1}: ${u}`).join('\n');
      return { content: [{ type: 'text', text: `✅ تم توليد الفيديو بنجاح\n\n${txt}` }] };
    }
    if (updated.type === 'merge') {
      const url = urls[0];
      return {
        content: [{ type: 'text', text: `✅ تم دمج المقاطع بنجاح\n\nالرابط المباشر: ${url}\n\n⚠️ ملف الدمج يُحذف من خدمة الدمج بعد ~24 ساعة — شاهده/نزّله سريعًا.` }],
      };
    }
  }

  if (updated.status === 'failed') {
    return { content: [{ type: 'text', text: `❌ فشلت المهمة: ${updated.error_message || 'خطأ غير معروف'}` }], isError: true };
  }

  // processing
  return {
    content: [
      { type: 'text', text: `⏳ المهمة قيد المعالجة — task_id: ${task_id}\nالتقدم: ${updated.progress || 0}%\n\nتابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.` },
    ],
  };
}

// تنفيذ أداة list_media
async function handleListMedia(args: any): Promise<{ content: any[] }> {
  const limit = Math.min(50, Math.max(1, args.limit || 10));
  const tasks = await listRecentTasks(limit, { type: args.type, status: args.status });
  if (tasks.length === 0) {
    return { content: [{ type: 'text', text: 'لا توجد مهام مطابقة.' }] };
  }
  const lines = tasks.map((t) => {
    const urls: string[] = JSON.parse(t.result_urls_json || '[]');
    const url = urls[0] || '—';
    return `• [${t.type}] ${t.status} — ${t.model}\n  task_id: ${t.id}\n  url: ${url}\n  created: ${t.created_at}`;
  });
  return { content: [{ type: 'text', text: `أحدث ${tasks.length} مهام:\n\n${lines.join('\n\n')}` }] };
}

// الموزّع الرئيسي
export async function executeTool(name: string, args: any): Promise<{ content: any[]; isError?: boolean }> {
  try {
    switch (name) {
      case 'generate_image': return await handleGenerateImage(args);
      case 'generate_video': return await handleGenerateVideo(args);
      case 'merge_videos': return await handleMergeVideos(args);
      case 'get_task': return await handleGetTask(args);
      case 'list_media': return await handleListMedia(args);
      default:
        return { content: [{ type: 'text', text: `❌ أداة غير معروفة: ${name}. المتاح: generate_image, generate_video, merge_videos, get_task, list_media` }], isError: true };
    }
  } catch (e: any) {
    return { content: [{ type: 'text', text: `❌ خطأ: ${e.message}` }], isError: true };
  }
}

export const SERVER_INSTRUCTIONS = `AI media generation server (kie.ai + CometAPI with automatic sequential multi-key failover, plus video merging).
Workflow: call generate_image or generate_video. If the response contains finished URLs, show them to the user.
If it returns a task_id with status PROCESSING, call get_task with that task_id every ~10 seconds until status is completed (show the URL) or failed (explain why).
IMPORTANT: the server automatically switches API keys in strict order on any failure (exhausted balance, invalid key, rate limits) and continues the SAME task under the same task_id — you will never encounter key/balance errors. Never stop or warn the user about keys or balances; just keep polling get_task until the result appears.
To concatenate several finished clips into one video, call merge_videos with 'urls' (direct links) or 'task_ids' (completed video tasks, in merge order); track it with get_task the same way. Note: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.
Use list_media to recall previously generated media from the database.`;
