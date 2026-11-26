import test from 'node:test';
import assert from 'node:assert/strict';

import { taskElapsedMs, formatDuration } from '../extension/core/task-duration.mjs';

test('任务总耗时从启动时计算，运行、暂停和可继续的停止都包含等待时间', () => {
  for (const status of ['running', 'pausing', 'paused', 'stopping', 'stopped']) {
    assert.equal(taskElapsedMs({ status, createdAt: 1000, updatedAt: 5000 }, 91000), 90000);
  }
});

test('任务结束后耗时固定在最后更新时间，晚些查看或归档也不增长', () => {
  const task = { status: 'completed', createdAt: 1000, updatedAt: 62000 };
  assert.equal(taskElapsedMs(task, 99000), 61000);
  assert.equal(taskElapsedMs(task, 1000000), 61000);
  assert.equal(taskElapsedMs({ status: 'completed', createdAt: 0, updatedAt: 0 }, 1000), 0);
});

test('旧记录缺少时间或时间逆序时显示未记录，不推测任务耗时', () => {
  for (const [task, now] of [
    [null, 1000], [{ status: 'unknown', createdAt: 0 }, 1000],
    [{ status: 'running', createdAt: null }, 1000], [{ status: 'running' }, 1000],
    [{ status: 'running', createdAt: '0' }, 1000], [{ status: 'running', createdAt: -1 }, 1000],
    [{ status: 'running', createdAt: Infinity }, 1000], [{ status: 'running', createdAt: 2000 }, 1000],
    [{ status: 'running', createdAt: 0 }, NaN], [{ status: 'completed', createdAt: 0 }, 1000],
    [{ status: 'completed', createdAt: 0, updatedAt: null }, 1000],
    [{ status: 'completed', createdAt: 2000, updatedAt: 1000 }, 10000],
  ]) assert.equal(taskElapsedMs(task, now), null);
});

test('总耗时按完整秒显示，可读分钟和超过一天的小时数', () => {
  for (const [ms, expected] of [[0, '0 秒'], [999, '0 秒'], [59000, '59 秒'], [60000, '1 分 00 秒'], [62000, '1 分 02 秒'], [3600000, '1 小时 00 分 00 秒'], [3662000, '1 小时 01 分 02 秒'], [90061000, '25 小时 01 分 01 秒'], [null, '未记录'], [undefined, '未记录'], [NaN, '未记录'], [-1, '未记录']]) {
    assert.equal(formatDuration(ms), expected);
  }
});
