// 消息规则的唯一来源：条数、字数上限和链接校验。
// 后端（队列、模板）与工作台都必须从这里取，禁止任何一处再写死数字——
// 前后端各存一份限制值时，改一处就会变成“界面放过、后台报错”。
// 本模块必须保持纯函数、无 Chrome API 依赖，工作台页面才能直接 import。

export const MESSAGE_TYPES = ['text', 'link', 'image'];

/** 单次任务的消息条数上限。 */
export const MAX_MESSAGES = 10;
/** 单条文字消息的字数上限。 */
export const MAX_TEXT_LENGTH = 2400;
/** 单条链接消息的字符上限。 */
export const MAX_LINK_LENGTH = 2000;
/** 旧版单条话术模板的字数上限。 */
export const MAX_TEMPLATE_LENGTH = 2000;
/** 任务名称的字数上限（按 trim 后的长度计）。 */
export const MAX_TASK_NAME_LENGTH = 80;
/** 单次任务的达人人数上限。 */
export const MAX_CREATORS = 200;

/** 唯一受支持的变量占位符。 */
export const NAME_VARIABLE = '{{name}}';

// 只接受不带空白与凭证的 http(s) 绝对地址。相对地址、伪协议和
// https://user:pass@host 一律拒绝：网址里的凭证会随消息一起发给达人。
export function isDeliverableLink(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_LINK_LENGTH) return false;
  if (/\s/.test(value) || !/^https?:\/\//i.test(value)) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
}

// 模板只支持 {{name}}；未知或未闭合的变量会让达人直接看到原始占位符。
export function hasUnknownVariable(value) {
  if (typeof value !== 'string') return false;
  const remainder = value.replaceAll(NAME_VARIABLE, '');
  return remainder.includes('{{') || remainder.includes('}}');
}
