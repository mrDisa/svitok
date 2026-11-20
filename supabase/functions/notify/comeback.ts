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
  const streakDue = Number(progress.streak?.count) > 0 && dateDay(progress.streak?.last) === today - 1 && !doneToday;
  if (planDue && streakDue) return { title: 'План и серия ждут вас', body: 'Сегодня в плане осталось чтение. Выполните дневную цель, чтобы сохранить серию.', hash: '#bible' };
  if (planDue) return { title: 'Продолжим план?', body: 'В плане осталось непрочитанное. Вернитесь к чтению — можно начать с одной главы.', hash: '#bible' };
  if (doneToday || dateDay(progress.streak?.last) === today) return null;
  if (streakDue) return { title: 'Время для чтения', body: 'Сегодня цель ещё не выполнена. Уделите немного времени чтению, чтобы продолжить серию.', hash: '#app' };
  if (progress.goal) return { title: 'Немного времени для Слова', body: 'Сегодняшняя цель ещё впереди. Откройте «Свиток» и прочитайте несколько стихов.', hash: '#app' };
  return null;
}

// Каждый день и устройство получают стабильный случайный 15-минутный слот.
// Повтор cron не выбирает новое время; пропущенный слот догоняется до 21:00.
export function reminderMinute(endpoint: string, date: string) {
  let hash = 2166136261;
  for (const ch of `${date}:${endpoint}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 11 * 60 + (hash % 40) * 15;
}
export function reminderDue(endpoint: string, date: string, tz: number, now = Date.now()) {
  const d = new Date(now + tz * 60_000);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minute >= reminderMinute(endpoint, date) && minute < 21 * 60;
}
