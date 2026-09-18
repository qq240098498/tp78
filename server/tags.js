// 标签：打在文案上的轻量标记，作用域是模块。删除标签只把它从各条文案上摘掉，
// 文案本身一条都不动；改名则直接换名字，引用跟着 id 走
const crypto = require('crypto');
const { load, save, MAX_TAG_NAME_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');
const { validateModule } = require('./entries');

// 标签列表：可按模块过滤。顺带统计每个标签在多少条文案上出现，页面据此展示用量
function listTags(options) {
  const input = options && typeof options === 'object' ? options : {};
  const module = pickText(input.module);
  const data = load();
  const usage = new Map();
  data.entries.forEach((entry) => {
    entry.tagIds.forEach((id) => usage.set(id, (usage.get(id) || 0) + 1));
  });
  const tags = data.tags
    .filter((tag) => !module || tag.module === module)
    .sort((a, b) => (a.module !== b.module
      ? (a.module < b.module ? -1 : 1)
      : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : 1)))
    .map((tag) => ({ ...tag, usage: usage.get(tag.id) || 0 }));
  return { tags };
}

function findTag(data, id) {
  const value = pickText(id);
  if (!value) throw new ApiError(400, 'TAG_REQUIRED', '请选择标签', 'id');
  const found = data.tags.find((tag) => tag.id === value);
  if (!found) throw new ApiError(404, 'TAG_NOT_FOUND', '这个标签不存在或已被删除', 'id');
  return found;
}

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'TAG_NAME_REQUIRED', '请填写标签名', 'name');
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new ApiError(400, 'TAG_NAME_TOO_LONG', `标签名不能超过 ${MAX_TAG_NAME_LENGTH} 个字符`, 'name');
  }
  return name;
}

// 标签名在同一个模块内不能重复（忽略层级，标签没有层级概念）
function assertNameFree(tags, module, name, selfId) {
  const hit = tags.find((tag) => tag.module === module
    && tag.id !== selfId
    && tag.name === name);
  if (hit) throw new ApiError(409, 'TAG_NAME_DUPLICATED', `模块 ${module} 下已经有名为「${name}」的标签了`, 'name');
}

function createTag(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const module = validateModule(input.module);
  const name = validateName(input.name);
  assertNameFree(data.tags, module, name, '');

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    module,
    name,
    createdAt: now,
    updatedAt: now,
  };
  data.tags.push(created);
  save(data);
  return created;
}

function renameTag(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const tag = findTag(data, id);
  const name = validateName(input.name === undefined ? tag.name : input.name);
  assertNameFree(data.tags, tag.module, name, tag.id);
  tag.name = name;
  tag.updatedAt = new Date().toISOString();
  save(data);
  return tag;
}

// 删除标签：只清理各条文案 tagIds 里的引用，文案一条都不删
function deleteTag(id) {
  const data = load();
  const tag = findTag(data, id);
  let detached = 0;
  data.entries.forEach((entry) => {
    if (!entry.tagIds.includes(tag.id)) return;
    entry.tagIds = entry.tagIds.filter((value) => value !== tag.id);
    detached += 1;
  });
  data.tags = data.tags.filter((item) => item.id !== tag.id);
  save(data);
  return { id: tag.id, name: tag.name, detached };
}

module.exports = {
  listTags,
  findTag,
  createTag,
  renameTag,
  deleteTag,
};
