const crypto = require('crypto');
const { load, save, MAX_TAG_NAME_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

// 标签挂在模块这一层：标签名在同一个模块内不能重复，跨模块可以重名。
// 删除标签只是把它从文案上摘掉，文案本身一条都不动

// entries 模块反过来会引用本模块的 resolveEntryTagIds，构成循环依赖，
// 这里在真正用到时再取，避免模块加载阶段拿到空导出
function validateModuleName(value) {
  return require('./entries').validateModule(value);
}

function findTag(data, id) {
  const value = pickText(id);
  if (!value) throw new ApiError(400, 'TAG_ID_REQUIRED', '请选择标签', 'id');
  const found = data.tags.find((item) => item.id === value);
  if (!found) throw new ApiError(404, 'TAG_NOT_FOUND', '这个标签不存在或已被删除', 'id');
  return found;
}

function validateName(value) {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new ApiError(400, 'TAG_NAME_REQUIRED', '请填写标签名', 'name');
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new ApiError(400, 'TAG_NAME_TOO_LONG', `标签名不能超过 ${MAX_TAG_NAME_LENGTH} 个字符`, 'name');
  }
  return name;
}

// 同一个模块下标签名不能重复，比较时忽略大小写
function assertNameFree(data, name, module, selfId) {
  const hit = data.tags.find((item) => item.module === module
    && item.id !== selfId
    && item.name.toLowerCase() === name.toLowerCase());
  if (hit) throw new ApiError(409, 'TAG_NAME_DUPLICATED', `模块 ${module} 下已经有“${hit.name}”这个标签了`, 'name');
}

// 列出标签：可以按模块过滤，返回时带上每个标签在本模块内被多少条文案引用
function listTags(options) {
  const input = options && typeof options === 'object' ? options : {};
  const module = pickText(input.module);
  const data = load();

  const counts = new Map();
  data.entries.forEach((item) => {
    item.tags.forEach((tagId) => {
      if (!module || item.module === module) counts.set(tagId, (counts.get(tagId) || 0) + 1);
    });
  });

  let tags = data.tags;
  if (module) tags = tags.filter((item) => item.module === module);
  tags = tags.map((item) => ({ ...item, entryCount: counts.get(item.id) || 0 }));
  return { tags };
}

function createTag(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const module = validateModuleName(input.module);
  const name = validateName(input.name);
  assertNameFree(data, name, module, '');

  const created = {
    id: crypto.randomUUID(),
    name,
    module,
    createdAt: new Date().toISOString(),
  };
  data.tags.push(created);
  save(data);
  return created;
}

function updateTag(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const tag = findTag(data, id);
  const name = input.name === undefined ? tag.name : validateName(input.name);
  assertNameFree(data, name, tag.module, tag.id);
  tag.name = name;
  save(data);
  return tag;
}

// 删除标签：先把所有文案身上这个标签摘掉，再删标签本身，文案一条都不删
function deleteTag(id) {
  const data = load();
  const tag = findTag(data, id);
  let detached = 0;
  data.entries.forEach((item) => {
    if (!item.tags.includes(tag.id)) return;
    item.tags = item.tags.filter((tagId) => tagId !== tag.id);
    detached += 1;
  });
  data.tags = data.tags.filter((item) => item.id !== tag.id);
  save(data);
  return { id: tag.id, name: tag.name, module: tag.module, detached };
}

// 文案保存时校验勾选的标签：必须是数组，每个标签都要存在，而且属于这条文案所在的模块，
// 重复勾选自动去重
function resolveEntryTagIds(data, rawTags, module) {
  if (rawTags === undefined || rawTags === null) return [];
  if (!Array.isArray(rawTags)) {
    throw new ApiError(400, 'TAGS_INVALID', '标签需要按条勾选', 'tags');
  }
  const result = [];
  rawTags.forEach((value) => {
    const tagId = pickText(value);
    if (!tagId) return;
    const tag = data.tags.find((item) => item.id === tagId);
    if (!tag) throw new ApiError(400, 'TAG_UNKNOWN', '所选标签不存在或已被删除', 'tags');
    if (tag.module !== module) {
      throw new ApiError(400, 'TAG_MODULE_MISMATCH', `标签“${tag.name}”属于 ${tag.module} 模块，不能打到 ${module} 模块的文案上`, 'tags');
    }
    if (!result.includes(tag.id)) result.push(tag.id);
  });
  return result;
}

module.exports = {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  findTag,
  resolveEntryTagIds,
};
