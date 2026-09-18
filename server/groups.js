const crypto = require('crypto');
const { load, save, MAX_GROUP_NAME_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

// 分组是模块之外再套的一层组织方式，全局通用，最多两级：一级分组与它下面的子分组。
// 分组的先后顺序直接体现在数据数组里，落盘后重新打开页面仍然一样

function findGroup(data, id) {
  const value = pickText(id);
  if (!value) throw new ApiError(400, 'GROUP_ID_REQUIRED', '请选择分组', 'groupId');
  const found = data.groups.find((item) => item.id === value);
  if (!found) throw new ApiError(404, 'GROUP_NOT_FOUND', '这个分组不存在或已被删除', 'groupId');
  return found;
}

function validateName(value) {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new ApiError(400, 'GROUP_NAME_REQUIRED', '请填写分组名', 'name');
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    throw new ApiError(400, 'GROUP_NAME_TOO_LONG', `分组名不能超过 ${MAX_GROUP_NAME_LENGTH} 个字符`, 'name');
  }
  return name;
}

// 同一层（同父分组）下名称不能重复，比较时忽略大小写
function assertNameFree(data, name, parentId, selfId) {
  const hit = data.groups.find((item) => item.parentId === parentId
    && item.id !== selfId
    && item.name.toLowerCase() === name.toLowerCase());
  if (hit) throw new ApiError(409, 'GROUP_NAME_DUPLICATED', `同一层里已经有叫“${hit.name}”的分组了`, 'name');
}

function hasChildren(data, groupId) {
  return data.groups.some((item) => item.parentId === groupId);
}

// candidateId 是否是 ancestorId 的后代（含儿子、孙子……）
function isDescendant(data, ancestorId, candidateId) {
  let current = data.groups.find((item) => item.id === candidateId);
  const guard = new Set();
  while (current && current.parentId !== null) {
    if (current.parentId === ancestorId) return true;
    if (guard.has(current.id)) return false; // 数据成环时兜底，正常数据不会走到
    guard.add(current.id);
    current = data.groups.find((item) => item.id === current.parentId);
  }
  return false;
}

// 校验父分组取值：null 表示一级分组；非空时必须存在、不能是自己或自己的后代、本身不能是子分组
function resolveParentId(data, rawParentId, selfId) {
  if (rawParentId === undefined || rawParentId === null) return null;
  const parentId = pickText(rawParentId);
  if (!parentId) return null;
  const parent = data.groups.find((item) => item.id === parentId);
  if (!parent) throw new ApiError(404, 'GROUP_PARENT_NOT_FOUND', '指定的父分组不存在或已被删除', 'parentId');
  if (parent.id === selfId) {
    throw new ApiError(409, 'GROUP_PARENT_SELF', '不能把分组挪到它自己下面', 'parentId');
  }
  if (isDescendant(data, selfId, parent.id)) {
    throw new ApiError(409, 'GROUP_PARENT_DESCENDANT', '不能把分组挪到它自己的子分组下面', 'parentId');
  }
  if (parent.parentId !== null) {
    throw new ApiError(409, 'GROUP_LEVEL_EXCEEDED', '分组最多两级，不能在子分组下面再挂子分组', 'parentId');
  }
  return parent.id;
}

// 按数组顺序列出，返回扁平清单，页面自己按 parentId 拼成两级树
function listGroups() {
  const data = load();
  const counts = new Map();
  data.entries.forEach((item) => {
    if (item.groupId) counts.set(item.groupId, (counts.get(item.groupId) || 0) + 1);
  });
  const groups = serializeOrder(data).map((item) => ({
    ...item,
    entryCount: counts.get(item.id) || 0,
  }));
  return { groups };
}

function createGroup(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const name = validateName(input.name);
  const parentId = resolveParentId(data, input.parentId === undefined ? null : input.parentId, '');
  assertNameFree(data, name, parentId, '');

  const created = {
    id: crypto.randomUUID(),
    name,
    parentId,
    createdAt: new Date().toISOString(),
  };
  data.groups.push(created);
  save(data);
  return created;
}

// 修改分组：改名、移动（parentId）与排序（afterId）都走这里，改完立刻落盘。
// afterId 说明目标位置排在谁后面：传 null 表示放到本层最前；不传表示保持原位（换层时排到末尾）
function updateGroup(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const group = findGroup(data, id);

  const name = input.name === undefined ? group.name : validateName(input.name);
  const parentChanged = input.parentId !== undefined
    && (pickText(input.parentId) || null) !== group.parentId;
  const parentId = input.parentId === undefined
    ? group.parentId
    : resolveParentId(data, input.parentId, group.id);

  // 一级分组下面还挂着子分组时，不能把它降成子分组，否则它的子分组就变成第三级了
  if (parentId !== null && group.parentId === null && hasChildren(data, group.id)) {
    throw new ApiError(409, 'GROUP_HAS_CHILDREN', '这个分组下面还有子分组，挪进去会超过两级，请先把它的子分组挪走', 'parentId');
  }

  assertNameFree(data, name, parentId, group.id);

  // afterId 说明目标位置排在同层的谁后面：null 放最前；不传时换层排末尾、不换层保持原位
  let afterId;
  let positionMode;
  if (input.afterId === undefined) {
    positionMode = parentChanged ? 'end' : 'keep';
  } else if (input.afterId === null) {
    positionMode = 'front';
  } else {
    afterId = pickText(input.afterId);
    if (!afterId) {
      positionMode = 'front';
    } else {
      const anchor = data.groups.find((item) => item.id === afterId);
      if (!anchor || anchor.parentId !== parentId || anchor.id === group.id) {
        throw new ApiError(400, 'GROUP_ANCHOR_INVALID', '排序位置无效：要放在同一层的另一个分组后面', 'afterId');
      }
      positionMode = 'after';
    }
  }

  group.name = name;
  group.parentId = parentId;
  if (positionMode !== 'keep') reorder(data, group, parentId, positionMode, afterId);
  save(data);
  return serializeOrder(data).find((item) => item.id === group.id);
}

// 在同层内调整目标分组的位置。整体顺序按“一级分组 + 紧跟其下的子分组”序列化，
// 只改这一层的相对顺序，其它分组相对位置不动
function reorder(data, movedGroup, parentId, mode, anchorId) {
  const orderMap = collectOrder(data);
  const siblings = (orderMap.get(parentId) || []).filter((groupId) => groupId !== movedGroup.id);
  if (mode === 'front') {
    siblings.unshift(movedGroup.id);
  } else if (mode === 'end') {
    siblings.push(movedGroup.id);
  } else {
    const index = siblings.indexOf(anchorId);
    siblings.splice(index === -1 ? siblings.length : index + 1, 0, movedGroup.id);
  }
  orderMap.set(parentId, siblings);
  writeOrder(data, orderMap);
}

// 按层收集顺序：parentId(null 表示第一层) -> 有序 id 列表
function collectOrder(data) {
  const order = new Map();
  data.groups.forEach((item) => {
    const key = item.parentId === null ? null : item.parentId;
    if (!order.has(key)) order.set(key, []);
    order.get(key).push(item.id);
  });
  return order;
}

// 用分层顺序重排 data.groups：一级分组按序，每个一级分组后紧跟它的子分组
function writeOrder(data, orderMap) {
  const byId = new Map(data.groups.map((item) => [item.id, item]));
  const roots = orderMap.get(null) || [];
  const result = [];
  roots.forEach((rootId) => {
    const root = byId.get(rootId);
    if (root) result.push(root);
    (orderMap.get(rootId) || []).forEach((childId) => {
      const child = byId.get(childId);
      if (child) result.push(child);
    });
  });
  // 兜底：理论上所有分组都在顺序表里，万一漏了就按原相对顺序补到最后
  data.groups.forEach((item) => {
    if (!result.includes(item)) result.push(item);
  });
  data.groups = result;
}

// 输出时也统一走一遍分层排序，保证读到的顺序与写入一致
function serializeOrder(data) {
  const orderMap = collectOrder(data);
  const byId = new Map(data.groups.map((item) => [item.id, item]));
  const result = [];
  (orderMap.get(null) || []).forEach((rootId) => {
    const root = byId.get(rootId);
    if (root) result.push(root);
    (orderMap.get(rootId) || []).forEach((childId) => {
      const child = byId.get(childId);
      if (child) result.push(child);
    });
  });
  data.groups.forEach((item) => {
    if (!result.includes(item)) result.push(item);
  });
  return result;
}

// 删除分组：分组里的文案不删，改为“未分组”；它下面的子分组提升为一级分组
function deleteGroup(id) {
  const data = load();
  const group = findGroup(data, id);

  data.groups.forEach((item) => {
    if (item.parentId === group.id) item.parentId = null;
  });
  let detached = 0;
  data.entries.forEach((item) => {
    if (item.groupId === group.id) {
      item.groupId = null;
      detached += 1;
    }
  });
  data.groups = data.groups.filter((item) => item.id !== group.id);
  save(data);
  return { id: group.id, name: group.name, detached };
}

// 文案保存时校验它挂的分组：留空表示未分组，非空时必须真实存在（分组跨模块通用）
function resolveEntryGroupId(data, rawGroupId) {
  if (rawGroupId === undefined || rawGroupId === null) return null;
  const groupId = pickText(rawGroupId);
  if (!groupId) return null;
  const exists = data.groups.some((item) => item.id === groupId);
  if (!exists) throw new ApiError(400, 'GROUP_UNKNOWN', '所选分组不存在或已被删除', 'groupId');
  return groupId;
}

module.exports = {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  findGroup,
  resolveParentId,
  isDescendant,
  resolveEntryGroupId,
};
