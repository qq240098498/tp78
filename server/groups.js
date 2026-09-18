// 分组：挂在模块之上的组织层，最多两级。父子关系与兄弟先后顺序都落在数据文件里，
// 任何一次移动或重排成功返回时就已经写盘，重新打开页面读到的就是最新结构
const crypto = require('crypto');
const { load, save, MAX_GROUP_NAME_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');
const { validateModule } = require('./entries');

// 同一模块同一层下的兄弟分组，按 order 排好返回
function siblingsOf(groups, module, parentId) {
  return groups
    .filter((group) => group.module === module && group.parentId === parentId)
    .sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : 1));
}

// 判断 candidate 是否是 ancestorId 的子孙（当前结构最多两级，循环写法对更深数据也成立）
function isDescendantOf(groups, candidate, ancestorId) {
  let current = candidate;
  const guard = new Set();
  while (current && current.parentId && !guard.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    guard.add(current.id);
    current = groups.find((group) => group.id === current.parentId);
  }
  return false;
}

// 列表默认按模块、层级、兄弟顺序展开：先输出一级分组，再紧跟它的子分组
function listGroups(options) {
  const input = options && typeof options === 'object' ? options : {};
  const module = pickText(input.module);
  const data = load();
  const modules = module ? [module] : [...new Set(data.groups.map((group) => group.module))].sort();
  const groups = [];
  modules.forEach((name) => {
    const parents = siblingsOf(data.groups, name, '');
    parents.forEach((parent) => {
      groups.push(parent);
      siblingsOf(data.groups, name, parent.id).forEach((child) => groups.push(child));
    });
  });
  return { groups };
}

function findGroup(data, id) {
  const value = pickText(id);
  if (!value) throw new ApiError(400, 'GROUP_REQUIRED', '请选择分组', 'id');
  const found = data.groups.find((group) => group.id === value);
  if (!found) throw new ApiError(404, 'GROUP_NOT_FOUND', '这个分组不存在或已被删除', 'id');
  return found;
}

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'GROUP_NAME_REQUIRED', '请填写分组名', 'name');
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    throw new ApiError(400, 'GROUP_NAME_TOO_LONG', `分组名不能超过 ${MAX_GROUP_NAME_LENGTH} 个字符`, 'name');
  }
  return name;
}

// 同模块、同父分组下名字不能重复；名字按去掉首尾空白后的原文比较
function assertNameFree(groups, module, parentId, name, selfId) {
  const hit = groups.find((group) => group.module === module
    && group.parentId === parentId
    && group.id !== selfId
    && group.name === name);
  if (hit) throw new ApiError(409, 'GROUP_NAME_DUPLICATED', `同一层下已经有名为「${name}」的分组了`, 'name');
}

// 给一整组兄弟连续重新编号，顺序即数组顺序，落盘后任何时候读回来都一致
function resequence(list) {
  list.forEach((group, index) => {
    group.order = index;
  });
}

function createGroup(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const module = validateModule(input.module);
  const name = validateName(input.name);
  const parentId = pickText(input.parentId);

  if (parentId) {
    const parent = data.groups.find((group) => group.id === parentId);
    // 子分组只能挂在一级分组下面，且必须在同一个模块里
    if (!parent) throw new ApiError(404, 'GROUP_PARENT_NOT_FOUND', '所选的上级分组不存在', 'parentId');
    if (parent.module !== module) {
      throw new ApiError(400, 'GROUP_PARENT_MODULE', '子分组必须和上级分组在同一个模块里', 'parentId');
    }
    if (parent.parentId) {
      throw new ApiError(400, 'GROUP_LEVEL_EXCEEDED', '分组最多两级，不能在子分组下面再建分组', 'parentId');
    }
  }
  assertNameFree(data.groups, module, parentId, name, '');

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    module,
    name,
    parentId,
    order: siblingsOf(data.groups, module, parentId).length,
    createdAt: now,
    updatedAt: now,
  };
  data.groups.push(created);
  save(data);
  return created;
}

function renameGroup(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const group = findGroup(data, id);
  const name = validateName(input.name === undefined ? group.name : input.name);
  assertNameFree(data.groups, group.module, group.parentId, name, group.id);
  group.name = name;
  group.updatedAt = new Date().toISOString();
  save(data);
  return group;
}

// 移动分组：parentId 决定新的父分组（空串表示一级分组），beforeId 决定新位置
// （空串表示放到这一层最后；不传且跨层时默认追加，同层时保持原位）
function moveGroup(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const group = findGroup(data, id);
  const targetParentId = input.parentId === undefined ? group.parentId : pickText(input.parentId);
  const hasBefore = Object.prototype.hasOwnProperty.call(input, 'beforeId');
  const beforeId = pickText(input.beforeId);

  let targetParent = null;
  if (targetParentId) {
    targetParent = data.groups.find((item) => item.id === targetParentId);
    if (!targetParent) throw new ApiError(404, 'GROUP_PARENT_NOT_FOUND', '所选的上级分组不存在', 'parentId');
    if (targetParent.module !== group.module) {
      throw new ApiError(400, 'GROUP_PARENT_MODULE', '分组不能移动到别的模块下面', 'parentId');
    }
    if (targetParent.parentId) {
      throw new ApiError(400, 'GROUP_LEVEL_EXCEEDED', '分组最多两级，不能挂到子分组下面', 'parentId');
    }
    // 当场拒绝挂到自己或自己的子分组下面：一级分组挂到自身即成环，
    // 子分组已是第二层，再往下挂就会出现第三级
    if (targetParent.id === group.id || isDescendantOf(data.groups, targetParent, group.id)) {
      throw new ApiError(400, 'GROUP_TARGET_SELF', '不能把分组移动到自己或自己的子分组下面', 'parentId');
    }
  }

  const isTopLevel = !group.parentId;
  if (isTopLevel && targetParent) {
    const childCount = data.groups.filter((item) => item.parentId === group.id).length;
    if (childCount > 0) {
      throw new ApiError(409, 'GROUP_HAS_CHILDREN', `这个分组下面还有 ${childCount} 个子分组，请先把它们移走再移动`, 'parentId');
    }
  }

  // 同层重名要当场拒绝，避免移动后悄悄出现两个同名分组
  assertNameFree(data.groups, group.module, targetParentId, group.name, group.id);

  const oldBucket = siblingsOf(data.groups, group.module, group.parentId);
  const newBucket = siblingsOf(data.groups, group.module, targetParentId)
    .filter((item) => item.id !== group.id);

  let insertAt = newBucket.length;
  if (hasBefore) {
    if (beforeId) {
      if (beforeId === group.id) {
        throw new ApiError(400, 'GROUP_TARGET_SELF', '不能把分组移动到自己前面', 'beforeId');
      }
      const anchor = newBucket.find((item) => item.id === beforeId);
      if (!anchor) {
        throw new ApiError(404, 'GROUP_ANCHOR_NOT_FOUND', '指定的相邻分组不在目标层里', 'beforeId');
      }
      insertAt = newBucket.indexOf(anchor);
    }
  } else if (targetParentId === group.parentId) {
    // 同层且没给位置时维持原序号（夹在剩余兄弟中的原位置）
    const oldIndex = oldBucket.findIndex((item) => item.id === group.id);
    insertAt = Math.min(oldIndex, newBucket.length);
  }

  newBucket.splice(insertAt, 0, group);
  group.parentId = targetParentId;
  group.updatedAt = new Date().toISOString();

  // 新旧两层都立刻重排并整体写盘，父子关系与先后顺序同一次保存生效
  resequence(oldBucket.filter((item) => item.id !== group.id));
  resequence(newBucket);
  save(data);
  return group;
}

// 同层调整先后顺序的便捷入口，规则与移动完全一致，只是父分组不变
function reorderGroup(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const group = findGroup(data, id);
  return moveGroup(group.id, { parentId: group.parentId, beforeId: input.beforeId });
}

function deleteGroup(id) {
  const data = load();
  const group = findGroup(data, id);

  const childCount = data.groups.filter((item) => item.parentId === group.id).length;
  if (childCount > 0) {
    throw new ApiError(409, 'GROUP_HAS_CHILDREN', `这个分组下面还有 ${childCount} 个子分组，请先移走或删除它们`, 'id');
  }
  const entryCount = data.entries.filter((item) => item.groupId === group.id).length;
  if (entryCount > 0) {
    throw new ApiError(409, 'GROUP_IN_USE', `这个分组里还有 ${entryCount} 条文案，请先把它们移到别的分组`, 'id');
  }

  data.groups = data.groups.filter((item) => item.id !== group.id);
  resequence(siblingsOf(data.groups, group.module, group.parentId));
  save(data);
  return { id: group.id, name: group.name };
}

module.exports = {
  listGroups,
  findGroup,
  createGroup,
  renameGroup,
  moveGroup,
  reorderGroup,
  deleteGroup,
  siblingsOf,
};
