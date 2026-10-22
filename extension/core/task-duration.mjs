const STATUSES = new Set(['running', 'pausing', 'paused', 'stopping', 'stopped', 'completed']);
const validTime = value => Number.isFinite(value) && value >= 0;

// Overall elapsed time includes intervals and pauses. A stopped task can still
// resume; only completed tasks have a fixed end time in the existing queue.
export function taskElapsedMs(task, now = Date.now()) {
  if (!STATUSES.has(task?.status) || !validTime(task.createdAt)) return null;
  const end = task.status === 'completed' ? task.updatedAt : now;
  if (!validTime(end) || end < task.createdAt) return null;
  return end - task.createdAt;
}

export function formatDuration(ms) {
  if (!validTime(ms)) return '未记录';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  const pad = value => String(value).padStart(2, '0');
  if (hours) return `${hours} 小时 ${pad(minutes)} 分 ${pad(seconds % 60)} 秒`;
  if (minutes) return `${minutes} 分 ${pad(seconds % 60)} 秒`;
  return `${seconds} 秒`;
}
