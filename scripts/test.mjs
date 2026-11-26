// 全量行为测试的唯一入口：本地、CI、npm test 都走这里，避免三处各写一份命令。
//
// 两个刻意的例外：
// 1. 排除 tests/local-build.test.mjs——它会动态生成本地测试插件，该工作已于
//    2026-10-16 暂停；生成器本身仍由 scripts/check.mjs 做语法检查。
// 2. 跳过「通过真实 CMD 从其他目录运行启动入口」——它会通过 launcher 间接生成
//    本地测试插件，暂停期间不执行。
//
// 并发固定为 2：默认并发下 tests/image-backend.test.mjs 曾在第 270 项后无输出挂起
// （单跑与 --test-concurrency=2 均通过，根因未定位）。
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAUSED_FILE = 'local-build.test.mjs';
const PAUSED_TEST = '通过真实 CMD 从其他目录运行启动入口';

const files = readdirSync(path.join(root, 'tests'))
  .filter(name => name.endsWith('.test.mjs') && name !== PAUSED_FILE)
  .map(name => path.join(root, 'tests', name))
  .sort();
if (!files.length) {
  process.stderr.write('未找到任何测试文件\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', `--test-skip-pattern=${PAUSED_TEST}`, ...files], { stdio: 'inherit', cwd: root });
if (result.error) {
  process.stderr.write(`无法启动测试进程：${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
