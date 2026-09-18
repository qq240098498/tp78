const crypto = require('crypto');
const {
  load,
  save,
  MAX_TRANSLATION_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_OPERATOR_LENGTH,
  MAX_ENTRY_TAGS,
  UNNAMED,
} = require('./store');
const { ApiError, pickText } = require('./errors');

const MODULE_PATTERN = /^[a-z][a-z0-9-]{0,29}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/;
const MAX_KEY_LENGTH = 120;
// 列表条数上限：先在完整结果上排好序再截断，翻页/多次筛选都不会重复或漏掉
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function validateModule(value) {
  const module = pickText(value);
  if (!module) throw new ApiError(400, 'MODULE_REQUIRED', '请填写模块名', 'module');
  if (!MODULE_PATTERN.test(module)) {
    throw new ApiError(400, 'MODULE_INVALID', '模块名要小写字母起头，后面可以跟数字与短横线，最长 30 个字符', 'module');
  }
  return module;
}

function validateKey(value) {
  const key = pickText(value);
  if (!key) throw new ApiError(400, 'KEY_REQUIRED', '请填写文案键', 'key');
  if (key.length > MAX_KEY_LENGTH) {
    throw new ApiError(400, 'KEY_TOO_LONG', `文案键不能超过 ${MAX_KEY_LENGTH} 个字符`, 'key');
  }
  if (!KEY_PATTERN.test(key)) {
    throw new ApiError(400, 'KEY_INVALID', '文案键要写成 home.banner.title 这样的形式，由小写字母、数字、下划线与短横线组成，并用点号至少分成两段', 'key');
  }
  return key;
}

// 译文逐条校验：语言必须是登记过的，取值必须是文本，长度不能超过上限
function validateTranslations(raw, languages) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(400, 'TRANSLATIONS_INVALID', '译文需要按语言逐条填写', 'translations');
  }
  const known = new Map();
  languages.forEach((item) => known.set(item.code.toLowerCase(), item.code));

  const result = {};
  Object.keys(raw).forEach((code) => {
    const value = raw[code];
    const actual = known.get(String(code).toLowerCase());
    if (!actual) {
      throw new ApiError(400, 'LANGUAGE_UNKNOWN', `语言 ${code} 没有登记过，请先在语言区登记这种语言`, `translations.${code}`);
    }
    if (typeof value !== 'string') {
      throw new ApiError(400, 'TRANSLATION_INVALID', `${actual} 的译文需要是文本`, `translations.${actual}`);
    }
    if (value.length > MAX_TRANSLATION_LENGTH) {
      throw new ApiError(400, 'TRANSLATION_TOO_LONG', `${actual} 的译文不能超过 ${MAX_TRANSLATION_LENGTH} 个字符，当前 ${value.length} 个字符`, `translations.${actual}`);
    }
    // 留空表示这条还没翻译，原样保留一个空串，方便页面上看出是空的还是根本没这一项
    result[actual] = value;
  });
  return result;
}

function validateNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new ApiError(400, 'NOTE_INVALID', '备注需要是文本', 'note');
  }
  if (value.length > MAX_NOTE_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `备注不能超过 ${MAX_NOTE_LENGTH} 个字符`, 'note');
  }
  return value.trim();
}

// 操作者：页面顶栏填的名字，留空按未署名记录，只做长度检查
function validateOperator(value, fallback) {
  if (value === undefined || value === null) return fallback || UNNAMED;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'OPERATOR_INVALID', '操作者需要是文本', 'operator');
  }
  const name = value.trim();
  if (!name) return UNNAMED;
  if (name.length > MAX_OPERATOR_LENGTH) {
    throw new ApiError(400, 'OPERATOR_TOO_LONG', `操作者名字不能超过 ${MAX_OPERATOR_LENGTH} 个字符`, 'operator');
  }
  return name;
}

// 分组归属：空串表示未分组；否则分组必须存在且和文案在同一个模块里
function validateGroupId(raw, data, module) {
  const groupId = pickText(raw);
  if (!groupId) return '';
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) throw new ApiError(404, 'GROUP_NOT_FOUND', '所选分组不存在或已被删除', 'groupId');
  if (group.module !== module) {
    throw new ApiError(400, 'GROUP_MODULE_MISMATCH', `分组「${group.name}」属于模块 ${group.module}，不能挂到模块 ${module} 的文案上`, 'groupId');
  }
  return group.id;
}

// 标签集合：去重后按首见顺序保留；每个标签都必须存在且同模块，数量有上限
function validateTagIds(raw, data, module) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(400, 'TAG_IDS_INVALID', '标签需要按数组提交', 'tagIds');
  }
  if (raw.length > MAX_ENTRY_TAGS) {
    throw new ApiError(400, 'TAG_IDS_TOO_MANY', `一条文案最多打 ${MAX_ENTRY_TAGS} 个标签，当前有 ${raw.length} 个`, 'tagIds');
  }
  const result = [];
  raw.forEach((value, index) => {
    const id = pickText(value);
    if (!id) {
      throw new ApiError(400, 'TAG_REQUIRED', `第 ${index + 1} 个标签没有选上`, `tagIds.${index}`);
    }
    if (result.includes(id)) return;
    const tag = data.tags.find((item) => item.id === id);
    if (!tag) throw new ApiError(404, 'TAG_NOT_FOUND', `标签 ${id} 不存在或已被删除`, `tagIds.${index}`);
    if (tag.module !== module) {
      throw new ApiError(400, 'TAG_MODULE_MISMATCH', `标签「${tag.name}」属于模块 ${tag.module}，不能打到模块 ${module} 的文案上`, `tagIds.${index}`);
    }
    result.push(tag.id);
  });
  return result;
}

// 同一个模块下不允许出现重复的键，比较时忽略大小写
function assertKeyFree(data, module, key, selfId) {
  const hit = data.entries.find((item) => item.module === module
    && item.id !== selfId
    && item.key.toLowerCase() === key.toLowerCase());
  if (hit) {
    throw new ApiError(409, 'KEY_DUPLICATED', `模块 ${module} 下已经有 ${hit.key} 这条文案了`, 'key');
  }
}

// 唯一的全序：模块、文案键、id 三段比较。筛选条件如何叠加、以什么顺序勾选，
// 最终都先汇成一个集合，再按这把固定的尺子排序，所以结果与先后顺序无关
function sortEntries(list) {
  return list.slice().sort((a, b) => {
    if (a.module !== b.module) return a.module < b.module ? -1 : 1;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// 把逗号分隔的查询值拆成去空白、去空项的数组，不做去重之外的任何顺序假设
function splitList(value) {
  const text = pickText(value);
  if (!text) return [];
  const seen = new Set();
  const result = [];
  text.split(',').forEach((piece) => {
    const item = piece.trim();
    if (item && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  });
  return result;
}

// 收集一个分组及其全部子孙分组的 id（当前结构最多两级，循环写法对更深的数据也成立）
function collectSubtreeIds(groups, rootId) {
  const ids = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    groups.forEach((group) => {
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        added = true;
      }
    });
  }
  return ids;
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ApiError(400, 'LIMIT_INVALID', '条数上限需要是正整数', 'limit');
  }
  return Math.min(limit, MAX_LIMIT);
}

// 译文填写状态的解析：zh-CN:filled 表示已填，en-US:missing 表示还空着
function parseFilledFilters(values, data) {
  const known = new Map();
  data.languages.forEach((item) => known.set(item.code.toLowerCase(), item.code));
  return values.map((expression) => {
    const [rawCode, rawState] = expression.split(':');
    const codeInput = (rawCode || '').trim();
    const state = (rawState || '').trim();
    const code = known.get(codeInput.toLowerCase());
    if (!code) throw new ApiError(400, 'LANGUAGE_UNKNOWN', `筛选条件里的语言 ${codeInput} 没有登记过`, 'filled');
    if (state !== 'filled' && state !== 'missing') {
      throw new ApiError(400, 'FILLED_STATE_INVALID', `译文状态需要写成 ${code}:filled 或 ${code}:missing`, 'filled');
    }
    return { code, filled: state === 'filled' };
  });
}

function isFilled(entry, code) {
  const value = entry.translations[code];
  return typeof value === 'string' && value.trim() !== '';
}

// 按模块、关键词、分组、标签、译文填写状态叠加筛选：条件族之间一律取交集；
// 同一族里的多个取值（分组、标签）按集合判成员，与勾选先后无关
function listEntries(options) {
  const input = options && typeof options === 'object' ? options : {};
  const module = pickText(input.module);
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();
  const groupIds = splitList(input.group);
  const tagIds = splitList(input.tag);
  const filled = parseFilledFilters(splitList(input.filled), data);
  const limit = parseLimit(input.limit);

  // 分组筛选命中选中分组自身与它的子孙；多个分组取并集后再与其他条件取交集
  let groupScope = null;
  if (groupIds.length) {
    groupScope = new Set();
    groupIds.forEach((id) => {
      const root = data.groups.find((group) => group.id === id);
      if (!root) throw new ApiError(404, 'GROUP_NOT_FOUND', `筛选的分组 ${id} 不存在或已被删除`, 'group');
      collectSubtreeIds(data.groups, root.id).forEach((sub) => groupScope.add(sub));
    });
  }

  // 标签筛选用成员集合判断：命中任意一个所选标签即算通过；选了不存在的标签直接报错
  let tagScope = null;
  if (tagIds.length) {
    tagScope = new Set();
    tagIds.forEach((id) => {
      const tag = data.tags.find((item) => item.id === id);
      if (!tag) throw new ApiError(404, 'TAG_NOT_FOUND', `筛选的标签 ${id} 不存在或已被删除`, 'tag');
      tagScope.add(tag.id);
    });
  }

  let list = data.entries;
  if (module) list = list.filter((item) => item.module === module);
  if (groupScope) list = list.filter((item) => item.groupId !== '' && groupScope.has(item.groupId));
  if (tagScope) list = list.filter((item) => item.tagIds.some((id) => tagScope.has(id)));
  if (filled.length) {
    // 每种语言各自是一条独立判定，多条之间同样取交集
    list = list.filter((item) => filled.every((rule) => isFilled(item, rule.code) === rule.filled));
  }
  if (keyword) {
    list = list.filter((item) => {
      if (item.key.toLowerCase().includes(keyword)) return true;
      return Object.keys(item.translations).some((code) => item.translations[code].toLowerCase().includes(keyword));
    });
  }

  // 先得到完整的确定性排序结果，再按上限截断：每一条的位置都固定，
  // 不会因为勾选顺序或截断边界而重复、漏掉
  const ordered = sortEntries(list);
  const total = ordered.length;
  const paged = ordered.slice(0, limit);

  const counts = {};
  data.entries.forEach((item) => {
    counts[item.module] = (counts[item.module] || 0) + 1;
  });
  const modules = Object.keys(counts).sort().map((name) => ({ module: name, count: counts[name] }));

  return { entries: paged, modules, total, returned: paged.length, limit };
}

function getEntry(id) {
  const data = load();
  const found = data.entries.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'ENTRY_NOT_FOUND', '这条文案不存在或已被删除', '');
  return found;
}

function createEntry(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const module = validateModule(input.module);
  const key = validateKey(input.key);
  const translations = validateTranslations(input.translations, data.languages);
  const groupId = validateGroupId(input.groupId, data, module);
  const tagIds = validateTagIds(input.tagIds, data, module);
  const note = validateNote(input.note);
  const operator = validateOperator(input.operator, UNNAMED);
  assertKeyFree(data, module, key, '');

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    module,
    key,
    groupId,
    tagIds,
    translations,
    note,
    updatedBy: operator,
    createdAt: now,
    updatedAt: now,
  };
  data.entries.push(created);
  save(data);
  return created;
}

function updateEntry(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.entries.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'ENTRY_NOT_FOUND', '这条文案不存在或已被删除', '');

  const module = input.module === undefined ? found.module : validateModule(input.module);
  const key = input.key === undefined ? found.key : validateKey(input.key);
  const translations = input.translations === undefined
    ? found.translations
    : validateTranslations(input.translations, data.languages);
  const groupId = input.groupId === undefined
    ? found.groupId
    : validateGroupId(input.groupId, data, module);
  const tagIds = input.tagIds === undefined
    ? found.tagIds
    : validateTagIds(input.tagIds, data, module);
  const note = input.note === undefined ? found.note : validateNote(input.note);
  const operator = validateOperator(input.operator, found.updatedBy);
  assertKeyFree(data, module, key, found.id);

  found.module = module;
  found.key = key;
  found.groupId = groupId;
  found.tagIds = tagIds;
  found.translations = translations;
  found.note = note;
  found.updatedBy = operator;
  found.updatedAt = new Date().toISOString();
  save(data);
  return found;
}

function deleteEntry(id) {
  const data = load();
  const index = data.entries.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'ENTRY_NOT_FOUND', '这条文案不存在或已被删除', '');
  const [removed] = data.entries.splice(index, 1);
  save(data);
  return { id: removed.id, key: removed.key };
}

module.exports = {
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  validateModule,
  validateKey,
  validateTranslations,
  validateOperator,
  validateGroupId,
  validateTagIds,
  sortEntries,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
