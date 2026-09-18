const crypto = require('crypto');
const { load, save, MAX_TRANSLATION_LENGTH, MAX_NOTE_LENGTH, MAX_OPERATOR_LENGTH, UNNAMED } = require('./store');
const { ApiError, pickText } = require('./errors');
const { resolveEntryGroupId } = require('./groups');
const { resolveEntryTagIds } = require('./tags');

const MODULE_PATTERN = /^[a-z][a-z0-9-]{0,29}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/;
const MAX_KEY_LENGTH = 120;
// 列表接口一次最多返回多少条，防止页面一次拉太多
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

// 同一个模块下不允许出现重复的键，比较时忽略大小写
function assertKeyFree(data, module, key, selfId) {
  const hit = data.entries.find((item) => item.module === module
    && item.id !== selfId
    && item.key.toLowerCase() === key.toLowerCase());
  if (hit) {
    throw new ApiError(409, 'KEY_DUPLICATED', `模块 ${module} 下已经有 ${hit.key} 这条文案了`, 'key');
  }
}

// 唯一且确定的先后顺序：先模块、再文案键、最后 id。
// 不管筛选条件传进来的先后如何，同一份数据排出来的顺序永远一致，
// 分页截断时既不会重复也不会漏掉
function sortEntries(list) {
  return list.slice().sort((a, b) => {
    if (a.module !== b.module) return a.module < b.module ? -1 : 1;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

// 把可能传成单个字符串或重复参数的值统一收成去重后的数组，并保持首次出现的顺序
function collectValues(value) {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : [value];
  const result = [];
  raw.forEach((item) => {
    const text = pickText(item);
    if (text && !result.includes(text)) result.push(text);
  });
  return result;
}

// 译文筛选值形如 zh-CN:filled（已填）或 zh-CN:missing（未填），缺省按“已填”处理
function parseTranslationFilter(value) {
  const text = pickText(value);
  if (!text) return null;
  const separator = text.lastIndexOf(':');
  if (separator === -1) return { code: text, expects: 'filled' };
  const code = text.slice(0, separator);
  const expects = text.slice(separator + 1) === 'missing' ? 'missing' : 'filled';
  return code ? { code, expects } : null;
}

// 收集某分组以及它所有后代分组的 id（分组最多两级，这里仍按任意深度遍历以防数据被手改）
function collectGroupTreeIds(data, groupId) {
  const ids = new Set([groupId]);
  let added = true;
  while (added) {
    added = false;
    data.groups.forEach((group) => {
      if (group.parentId !== null && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        added = true;
      }
    });
  }
  return ids;
}

// 分页参数：接口传进来是字符串，直接调用动作时也可能是数字，两种都认
function readNonNegativeInt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validatePagination(input) {
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  if (input.limit !== undefined && input.limit !== '') {
    limit = readNonNegativeInt(input.limit);
    if (limit === null || limit < 1) {
      throw new ApiError(400, 'LIMIT_INVALID', '每页条数需要是正整数', 'limit');
    }
    limit = Math.min(limit, MAX_LIMIT);
  }
  if (input.offset !== undefined && input.offset !== '') {
    offset = readNonNegativeInt(input.offset);
    if (offset === null || offset < 0) {
      throw new ApiError(400, 'OFFSET_INVALID', '偏移量需要是非负整数', 'offset');
    }
  }
  return { limit, offset };
}

// 按模块、分组、标签、译文填写情况与关键词叠加筛选。大类条件之间一律取交集：
// - 分组：单选，选中父分组时自动带上它下面全部子分组，__none__ 表示只看未分组
// - 标签：可多选，选中多个时命中任意一个即可（组内并集），整个标签条件与其它条件取交集
// - 译文：每种语言可各自要求“已填”或“未填”，列出的语言条件逐条都要满足（组内交集）
// 同一份数据不管筛选参数传进来的先后如何，结果与顺序都完全一致
function listEntries(options) {
  const input = options && typeof options === 'object' ? options : {};
  const module = pickText(input.module);
  const keyword = pickText(input.keyword).toLowerCase();
  const groupFilter = pickText(input.groupId);
  const tagIds = collectValues(input.tag);
  const translationFilters = collectValues(input.trans).map(parseTranslationFilter).filter(Boolean);
  const { limit, offset } = validatePagination(input);
  const data = load();

  // 分组条件：__none__ 表示只看未分组；具体分组带上它的全部子分组；传了不存在的 id 结果为空
  let groupIds = null;
  let ungroupedOnly = false;
  if (groupFilter === '__none__') {
    ungroupedOnly = true;
  } else if (groupFilter) {
    if (!data.groups.some((item) => item.id === groupFilter)) {
      groupIds = new Set(); // 选中的分组已被删除：条件什么都匹配不到
    } else {
      groupIds = collectGroupTreeIds(data, groupFilter);
    }
  }

  // 标签条件：命中任意一个选中标签即可；选中的标签已被删除时它的 id 匹配不到任何文案
  const tagSet = new Set();
  tagIds.forEach((tagId) => {
    if (data.tags.some((item) => item.id === tagId)) tagSet.add(tagId);
  });
  const tagActive = tagIds.length > 0;

  // 译文条件：逐条语言要求已填或未填，之间取交集；未登记的语言谁都满足不了
  const knownCodes = new Set(data.languages.map((item) => item.code));
  const isFilled = (item, code) => {
    const value = item.translations[code];
    return typeof value === 'string' && value.trim() !== '';
  };

  let matched = data.entries.filter((item) => {
    if (module && item.module !== module) return false;
    if (ungroupedOnly && item.groupId !== null) return false;
    if (groupIds && !groupIds.has(item.groupId)) return false;
    if (tagActive) {
      if (tagSet.size === 0) return false;
      if (!item.tags.some((tagId) => tagSet.has(tagId))) return false;
    }
    for (const filter of translationFilters) {
      if (!knownCodes.has(filter.code)) return false;
      const filled = isFilled(item, filter.code);
      if (filter.expects === 'filled' && !filled) return false;
      if (filter.expects === 'missing' && filled) return false;
    }
    if (keyword) {
      if (item.key.toLowerCase().includes(keyword)) return true;
      return Object.keys(item.translations).some((code) => item.translations[code].toLowerCase().includes(keyword));
    }
    return true;
  });

  matched = sortEntries(matched);
  const total = matched.length;
  const page = matched.slice(offset, offset + limit);

  // 模块、分组、标签的可选项始终基于全量数据统计，保证页面下拉不会因为筛选结果为空而消失
  const counts = {};
  data.entries.forEach((item) => {
    counts[item.module] = (counts[item.module] || 0) + 1;
  });
  const modules = Object.keys(counts).sort().map((name) => ({ module: name, count: counts[name] }));

  return {
    entries: page,
    modules,
    total,
    limit,
    offset,
    hasMore: offset + page.length < total,
  };
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
  const note = validateNote(input.note);
  const groupId = resolveEntryGroupId(data, input.groupId);
  const tagIds = resolveEntryTagIds(data, input.tags, module);
  const operator = validateOperator(input.operator, UNNAMED);
  assertKeyFree(data, module, key, '');

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    module,
    key,
    groupId,
    tags: tagIds,
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
  const note = input.note === undefined ? found.note : validateNote(input.note);
  const groupId = input.groupId === undefined ? found.groupId : resolveEntryGroupId(data, input.groupId);
  const tagIds = input.tags === undefined ? found.tags : resolveEntryTagIds(data, input.tags, module);
  const operator = validateOperator(input.operator, found.updatedBy);
  assertKeyFree(data, module, key, found.id);

  found.module = module;
  found.key = key;
  found.groupId = groupId;
  found.tags = tagIds;
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
};
