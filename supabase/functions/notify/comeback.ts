type Progress = {
  day?: { d?: string; done?: boolean; n?: number };
  goal?: number;
  streak?: { count?: number; last?: string };
  plans?: Record<string, { started?: number; done?: number[] }>;
};
const lengths: Record<string, number> = { john21: 21, proverbs31: 31, psalms30: 30, gospels40: 40, nt90: 90, bible365: 365 };
const localDay = (time: number, tz: number) => Math.floor((time + tz * 60_000) / 864e5);
const dateDay = (key = '') => {
  const [y, m, d] = key.split('-').map(Number);
  return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / 864e5) : NaN;
};
export function comeback(progress: Progress, tz: number, now = Date.now()) {
  const today = localDay(now, tz);
  const doneToday = dateDay(progress.day?.d) === today && (progress.day?.done || Number(progress.day?.n) >= (progress.goal || 10));
  const planDue = Object.entries(progress.plans || {}).some(([id, plan]) => {
    if (!lengths[id] || !Number.isFinite(plan.started)) return false;
    const due = Math.min(lengths[id] - 1, today - localDay(plan.started!, tz));
    const done = new Set(plan.done || []);
    return due >= 0 && Array.from({ length: due + 1 }, (_, i) => i).some(i => !done.has(i));
  });
  if (planDue) return { title: 'Продолжим план?', body: 'В плане осталось непрочитанное. Вернитесь к чтению — можно начать с одной главы.', hash: '#bible' };
  if (doneToday) return null;
  if (progress.streak?.last) return { title: 'Время для чтения', body: 'Сегодня цель ещё не выполнена. Уделите немного времени чтению, чтобы продолжить серию.', hash: '#app' };
  if (progress.goal) return { title: 'Немного времени для Слова', body: 'Сегодняшняя цель ещё впереди. Откройте «Свиток» и прочитайте несколько стихов.', hash: '#app' };
  return null;
}
