// src/lib/generation.ts — منسّق التوليد بالتبديل التسلسلي
// قلب المشروع: جرّب المرشحين بالترتيب، أول نجاح يربط المهمة بالمزود والمفتاح
// عند فشل مفتاح/رصيد في منتصف المهمة: أعد الإنشاء على المفتاح التالي بنفس task_id

import {
  getDb, getKeyPool, insertTask, getTask, updateTask,
  type ApiKeyRow, type Attempt, type TaskRow,
} from './turso';
import { PROVIDERS, type ApiKeyRef, type ProviderInput } from './providers';
import { ProviderError, classifyProviderError, shouldSwitchKey, type ErrorClass } from './errors';
import { resolveModel, type ModelDef } from './models';

// حدّث عدّادات المفتاح بعد كل محاولة
async function bumpKeyStats(keyId: string, success: boolean, errorMsg?: string): Promise<void> {
  const db = getDb();
  if (success) {
    await db.execute({
      sql: `UPDATE api_keys SET usage_count = usage_count + 1, success_count = success_count + 1, last_used_at = datetime('now') WHERE id = ?`,
      args: [keyId],
    });
  } else {
    await db.execute({
      sql: `UPDATE api_keys SET usage_count = usage_count + 1, fail_count = fail_count + 1, last_used_at = datetime('now', last_error = ?) WHERE id = ?`,
      args: [errorMsg || '', keyId],
    });
  }
}

// علّم المفتاح حسب فئة الخطأ
async function markKeyStatus(keyId: string, cls: ErrorClass, errorMsg: string): Promise<void> {
  const db = getDb();
  if (cls === 'disabled') {
    await db.execute({
      sql: `UPDATE api_keys SET status = 'disabled', last_error = ?, last_checked_at = datetime('now') WHERE id = ?`,
      args: [errorMsg, keyId],
    });
  } else if (cls === 'exhausted') {
    await db.execute({
      sql: `UPDATE api_keys SET status = 'exhausted', last_error = ?, last_checked_at = datetime('now') WHERE id = ?`,
      args: [errorMsg, keyId],
    });
  } else {
    await db.execute({
      sql: `UPDATE api_keys SET last_error = ?, last_checked_at = datetime('now') WHERE id = ?`,
      args: [errorMsg, keyId],
    });
  }
}

export interface GenerationResult {
  taskId: string;
  status: 'completed' | 'processing' | 'failed';
  urls?: string[];
  error?: string;
  progress?: number;
  model: string;
  type: 'image' | 'video';
}

// منسّق التوليد لأداة generate_image / generate_video
export async function runGeneration(args: {
  prompt: string;
  modelName: string;
  type: 'image' | 'video';
  input: ProviderInput;
  waitSeconds: number;
  onProgress?: (pct: number, msg: string) => void;
}): Promise<GenerationResult> {
  const model = resolveModel(args.modelName);
  if (!model) {
    return {
      taskId: '',
      status: 'failed',
      error: `موديل غير معروف: ${args.modelName}`,
      model: args.modelName,
      type: args.type,
    };
  }

  // اجلب كل المفاتيح النشطة للمزودين بهذا الترتيب
  const keys = await getKeyPool(model.providers);
  if (keys.length === 0) {
    return {
      taskId: '',
      status: 'failed',
      error: `لا توجد مفاتيح نشطة لخدمة ${model.canonical}. أضف مفتاحًا واحدًا على الأقل من واجهة الإدارة، ثم أعد المحاولة.`,
      model: model.canonical,
      type: args.type,
    };
  }

  // سجّل المهمة في Turso قبل أي نداء خارجي
  let taskId = '';
  try {
    taskId = await insertTask({
      model: model.canonical,
      type: args.type,
      prompt: args.prompt,
      params_json: { ...args.input, waitSeconds: args.waitSeconds },
      status: 'processing',
    });
  } catch (e: any) {
    return {
      taskId: '',
      status: 'failed',
      error: `فشل تسجيل المهمة: ${e.message}`,
      model: model.canonical,
      type: args.type,
    };
  }

  // جرّب المرشحين بالترتيب
  for (const key of keys) {
    const keyRef: ApiKeyRef = {
      id: key.id,
      provider: key.provider,
      api_key: key.api_key,
      label: key.label,
    };
    const provider = PROVIDERS[key.provider];
    if (!provider) continue;

    const attempt: Attempt = {
      provider: key.provider,
      keyId: key.id,
      keyLabel: key.label,
      ok: false,
      at: new Date().toISOString(),
    };

    try {
      // للصور: جرّب createImageSync أولًا (CometAPI تدعمها)
      if (args.type === 'image' && provider.createImageSync) {
        try {
          const syncResult = await provider.createImageSync(keyRef, { ...args.input, model: model.providerModel[key.provider] });
          attempt.ok = true;
          await bumpKeyStats(key.id, true);
          await updateTask(taskId, {
            status: 'completed',
            progress: 100,
            result_urls_json: syncResult.urls as any,
            provider: key.provider,
            key_id: key.id,
            attempt,
          });
          return { taskId, status: 'completed', urls: syncResult.urls, model: model.canonical, type: args.type };
        } catch (e: any) {
          // فشل الصورة المتزامنة — جرب المسار غير المتزامن
          if (e instanceof ProviderError) {
            const cls = classifyProviderError(e.status, e.message);
            attempt.errorClass = cls;
            attempt.error = e.message;
            await markKeyStatus(key.id, cls, e.message);
            await bumpKeyStats(key.id, false, e.message);
            await updateTask(taskId, { attempt });
            if (!shouldSwitchKey(cls)) {
              // params — توقف
              await updateTask(taskId, { status: 'failed', error: e.message });
              return { taskId, status: 'failed', error: e.message, model: model.canonical, type: args.type };
            }
            continue;
          }
          throw e;
        }
      }

      // المسار غير المتزامن: createTask
      const createResult = await provider.createTask(keyRef, model.providerModel[key.provider], args.input);
      attempt.ok = true;
      await bumpKeyStats(key.id, true);
      await updateTask(taskId, {
        provider: key.provider,
        provider_task_id: createResult.providerTaskId,
        key_id: key.id,
        attempt,
      });

      // انتظر خلال النافذة مع بث تقدم
      const deadline = Date.now() + args.waitSeconds * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const check = await provider.checkTask(keyRef, createResult.providerTaskId);
          if (check.progress) {
            args.onProgress?.(check.progress, `قيد التوليد… ${check.progress}%`);
            await updateTask(taskId, { progress: check.progress });
          }
          if (check.status === 'completed' && check.urls) {
            await updateTask(taskId, {
              status: 'completed',
              progress: 100,
              result_urls_json: check.urls as any,
            });
            return { taskId, status: 'completed', urls: check.urls, model: model.canonical, type: args.type };
          }
          if (check.status === 'failed') {
            // فشل في منتصف المهمة — هل هو خطأ مفتاح/رصيد؟
            const msg = check.error || '';
            const cls = classifyProviderError(0, msg);
            if (shouldSwitchKey(cls)) {
              // أعد المحاولة على المفتاح التالي بنفس task_id
              break;
            } else {
              await updateTask(taskId, { status: 'failed', error: msg });
              return { taskId, status: 'failed', error: msg, model: model.canonical, type: args.type };
            }
          }
        } catch (e: any) {
          if (e instanceof ProviderError) {
            const cls = classifyProviderError(e.status, e.message);
            attempt.errorClass = cls;
            attempt.error = e.message;
            await markKeyStatus(key.id, cls, e.message);
            await bumpKeyStats(key.id, false, e.message);
            if (shouldSwitchKey(cls)) {
              break; // جرّب المفتاح التالي
            } else {
              await updateTask(taskId, { status: 'failed', error: e.message, attempt });
              return { taskId, status: 'failed', error: e.message, model: model.canonical, type: args.type };
            }
          }
          // خطأ شبكة — استمر بالاستعلام
        }
      }

      // انتهت النافذة بدون نتيجة — المهمة تبقى processing
      return {
        taskId,
        status: 'processing',
        progress: 50,
        model: model.canonical,
        type: args.type,
      };
    } catch (e: any) {
      const msg = e.message || 'خطأ غير معروف';
      attempt.error = msg;
      if (e instanceof ProviderError) {
        attempt.errorClass = classifyProviderError(e.status, e.message);
        await markKeyStatus(key.id, attempt.errorClass, msg);
        await bumpKeyStats(key.id, false, msg);
        await updateTask(taskId, { attempt });
        if (!shouldSwitchKey(attempt.errorClass!)) {
          await updateTask(taskId, { status: 'failed', error: msg });
          return { taskId, status: 'failed', error: msg, model: model.canonical, type: args.type };
        }
      } else {
        await bumpKeyStats(key.id, false, msg);
        await updateTask(taskId, { attempt });
      }
      // جرّب المفتاح التالي
      continue;
    }
  }

  // فشل على كل المفاتيح — المهمة تبقى processing بانتظار توفر مفتاح صالح
  await updateTask(taskId, {
    status: 'processing',
    progress: 0,
    error_message: 'بانتظار توفر مفتاح صالح…',
  });
  return {
    taskId,
    status: 'processing',
    progress: 0,
    error: 'بانتظار توفر مفتاح صالح…',
    model: model.canonical,
    type: args.type,
  };
}

// تحديث مهمة جارية من المزود — يُستدعى من get_task
export async function refreshTask(taskId: string): Promise<TaskRow | null> {
  const task = await getTask(taskId);
  if (!task) return null;

  // المهمة مكتملة أو فاشلة — لا تحدّث
  if (task.status === 'completed' || task.status === 'failed') return task;

  // مهمة دمج — لا تحدّث هنا (لها مسار خاص في refreshMergeTask)
  if (task.type === 'merge') return task;

  // تحقق من توفر مفتاح صالح الآن (إعادة المحاولة بعد تهدئة ~45 ثانية)
  const updatedAt = new Date(task.updated_at + 'Z').getTime();
  if (Date.now() - updatedAt < 45000) return task;

  // أعد المحاولة على المفاتيح المتاحة
  const model = resolveModel(task.model);
  if (!model) return task;

  const keys = await getKeyPool(model.providers);
  if (keys.length === 0) return task;

  // جرّب كل مفتاح
  for (const key of keys) {
    const keyRef: ApiKeyRef = {
      id: key.id,
      provider: key.provider,
      api_key: key.api_key,
      label: key.label,
    };
    const provider = PROVIDERS[key.provider];
    if (!provider) continue;

    try {
      const params = JSON.parse(task.params_json || '{}');
      const input: ProviderInput = { ...params, prompt: task.prompt };
      const createResult = await provider.createTask(keyRef, model.providerModel[key.provider], input);
      await updateTask(taskId, {
        provider: key.provider,
        provider_task_id: createResult.providerTaskId,
        key_id: key.id,
      });
      // تحقق فورًا
      const check = await provider.checkTask(keyRef, createResult.providerTaskId);
      if (check.status === 'completed' && check.urls) {
        await updateTask(taskId, {
          status: 'completed',
          progress: 100,
          result_urls_json: check.urls as any,
        });
      } else if (check.status === 'failed') {
        // جرّب المفتاح التالي
        continue;
      }
      break; // نجاح الإنشاء — خرج من الحلقة
    } catch {
      continue; // جرّب المفتاح التالي
    }
  }

  return await getTask(taskId);
}
