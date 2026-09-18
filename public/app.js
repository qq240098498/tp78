// 页面交互：语言、分组、标签与文案都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const PAGE_SIZE_KEY = 'i18n-workbench-page-size';

const state = {
  languages: [],
  entries: [],
  modules: [],
  groups: [], // 扁平、有序的分组清单，页面按 parentId 拼两级树
  tags: [], // 全部标签（跨模块），需要某模块的就在前端过滤
  editingId: '',
  filters: {
    module: '',
    groupId: '',
    keyword: '',
    tagIds: new Set(), // 选中多个标签时命中任意一个即可
    trans: new Map(), // 语言代码 -> filled（已填）/ missing（未填）
  },
  page: { limit: Number(window.localStorage.getItem(PAGE_SIZE_KEY)) || 100, offset: 0, total: 0 },
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：各区块共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' ? target : target.querySelector('input, select');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 操作者名字记在浏览器里，刷新之后还在，保存时随请求一起带上
const OPERATOR_KEY = 'i18n-workbench-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadLanguages() {
  const payload = await request('/api/languages');
  state.languages = payload.languages || [];
  renderLanguages();
  renderTranslationInputs();
  renderTransFilterPanel();
}

async function loadGroups() {
  const payload = await request('/api/groups');
  state.groups = payload.groups || [];
  renderGroupTree();
  renderGroupSelects();
}

async function loadTags() {
  const payload = await request('/api/tags');
  state.tags = payload.tags || [];
  renderTagManager();
  renderTagFilterPanel();
  renderEntryTagChecks();
}

// ---- 分组树 ----------------------------------------------------------------

function groupById(id) {
  return state.groups.find((item) => item.id === id) || null;
}

function groupFullName(id) {
  const group = groupById(id);
  if (!group) return '';
  if (group.parentId) {
    const parent = groupById(group.parentId);
    return parent ? `${parent.name} / ${group.name}` : group.name;
  }
  return group.name;
}

function renderGroupTree() {
  const box = el('group-tree');
  const roots = state.groups.filter((item) => item.parentId === null);
  const childrenOf = (id) => state.groups.filter((item) => item.parentId === id);

  const row = (group, isChild) => {
    const siblings = isChild ? childrenOf(group.parentId) : roots;
    const index = siblings.findIndex((item) => item.id === group.id);
    const upDisabled = index <= 0 ? ' disabled' : '';
    const downDisabled = index >= siblings.length - 1 ? ' disabled' : '';

    // 可移动的目的地：顶层 + 其它一级分组（挂着子分组的一级分组不能整体挪进别人家里）
    const moveOptions = ['<option value="">移动到…</option>'];
    if (isChild) moveOptions.push('<option value="__top__">顶层（成为一级分组）</option>');
    roots.forEach((root) => {
      if (root.id === group.id) return;
      if (!isChild && childrenOf(group.id).length > 0) return;
      if (isChild && root.id === group.parentId) return;
      moveOptions.push(`<option value="${escapeHtml(root.id)}">${escapeHtml(root.name)}</option>`);
    });
    const canMove = moveOptions.length > 1;

    const actions = [
      !isChild ? `<button type="button" class="link" data-group-addchild="${escapeHtml(group.id)}">加子分组</button>` : '',
      `<button type="button" class="link" data-group-rename="${escapeHtml(group.id)}">改名</button>`,
      `<button type="button" class="link" data-group-up="${escapeHtml(group.id)}"${upDisabled}>上移</button>`,
      `<button type="button" class="link" data-group-down="${escapeHtml(group.id)}"${downDisabled}>下移</button>`,
      canMove ? `<select class="group-move" data-group-move="${escapeHtml(group.id)}" title="移动分组">${moveOptions.join('')}</select>` : '',
      `<button type="button" class="link danger" data-group-delete="${escapeHtml(group.id)}">删除</button>`,
    ].filter(Boolean);

    return `<div class="group-row${isChild ? ' child' : ''}">
      <span class="group-name">${escapeHtml(group.name)}</span>
      <span class="group-count">${group.entryCount} 条文案</span>
      <span class="group-actions">${actions.join('')}</span>
    </div>`;
  };

  box.innerHTML = roots.map((root) => {
    const kids = childrenOf(root.id);
    return row(root, false) + kids.map((child) => row(child, true)).join('');
  }).join('');
  el('group-empty').classList.toggle('hidden', state.groups.length > 0);
}

// 筛选区与文案表单共用的分组下拉，按两级缩进展示
function renderGroupSelects() {
  const options = ['<option value="">未分组</option>']
    .concat(state.groups.map((group) => {
      const prefix = group.parentId ? '　　└ ' : '';
      return `<option value="${escapeHtml(group.id)}">${prefix}${escapeHtml(group.name)}</option>`;
    }));

  const filterSelect = el('filter-group');
  const filterExtra = '<option value="__none__">只看未分组</option>';
  const filterCurrent = filterSelect.value;
  filterSelect.innerHTML = ['<option value="">全部分组</option>', filterExtra].concat(options.slice(1)).join('');
  const validFilterValues = new Set(['', '__none__'].concat(state.groups.map((group) => group.id)));
  filterSelect.value = validFilterValues.has(filterCurrent) ? filterCurrent : '';
  if (filterSelect.value !== filterCurrent) state.filters.groupId = filterSelect.value;

  const entrySelect = el('entry-group');
  const entryCurrent = entrySelect.value;
  entrySelect.innerHTML = options.join('');
  const validEntryValues = new Set([''].concat(state.groups.map((group) => group.id)));
  entrySelect.value = validEntryValues.has(entryCurrent) ? entryCurrent : '';
}

// ---- 标签管理 --------------------------------------------------------------

function tagsOfModule(module) {
  return state.tags.filter((tag) => tag.module === module);
}

function renderTagManager() {
  const moduleSelect = el('tag-module');
  const current = state.filters.module || moduleSelect.value || (state.modules[0] && state.modules[0].module) || '';
  const moduleOptions = state.modules.map((item) =>
    `<option value="${escapeHtml(item.module)}"${item.module === current ? ' selected' : ''}>${escapeHtml(item.module)}</option>`).join('');
  moduleSelect.innerHTML = moduleOptions;
  if (current && !state.modules.some((item) => item.module === current)) {
    moduleSelect.value = state.modules[0] ? state.modules[0].module : '';
  } else {
    moduleSelect.value = current;
  }

  const list = el('tag-chip-list');
  const tags = tagsOfModule(moduleSelect.value);
  list.innerHTML = tags.length ? tags.map((tag) =>
    `<span class="tag-chip">
      ${escapeHtml(tag.name)}<em>${tag.entryCount}</em>
      <button type="button" class="chip-btn" data-tag-rename="${escapeHtml(tag.id)}">改名</button>
      <button type="button" class="chip-btn danger" data-tag-delete="${escapeHtml(tag.id)}">删除</button>
    </span>`).join('')
    : '<span class="tag-manager-empty">这个模块还没有标签</span>';
}

// 筛选区里的标签多选面板：按模块过滤时只列这个模块，否则全部带上模块名
function renderTagFilterPanel() {
  const panel = el('filter-tag-panel');
  const module = state.filters.module;
  const tags = module ? tagsOfModule(module) : state.tags;
  if (!tags.length) {
    panel.innerHTML = '<div class="dropdown-empty">还没有可用标签</div>';
    return;
  }
  panel.innerHTML = tags.map((tag) => {
    const checked = state.filters.tagIds.has(tag.id) ? ' checked' : '';
    const suffix = module ? '' : ` <em class="tag-module">${escapeHtml(tag.module)}</em>`;
    return `<label class="check dropdown-check"><input type="checkbox" data-filter-tag="${escapeHtml(tag.id)}"${checked}> ${escapeHtml(tag.name)}${suffix}</label>`;
  }).join('');
}

// 筛选区里的译文填写面板：每种语言各自选 不限 / 已填 / 未填，多条之间取交集
function renderTransFilterPanel() {
  const panel = el('filter-trans-panel');
  // 语言被删除后，残留的筛选条件只会让结果恒为空，这里直接摘掉
  const known = new Set(state.languages.map((item) => item.code));
  Array.from(state.filters.trans.keys()).forEach((code) => {
    if (!known.has(code)) state.filters.trans.delete(code);
  });
  if (!state.languages.length) {
    panel.innerHTML = '<div class="dropdown-empty">还没有登记语言</div>';
    return;
  }
  panel.innerHTML = state.languages.map((language) => {
    const picked = state.filters.trans.get(language.code) || '';
    const option = (value, label) =>
      `<option value="${value}"${picked === value ? ' selected' : ''}>${label}</option>`;
    return `<label class="trans-filter-row">
      <span>${escapeHtml(language.code)}</span>
      <select data-filter-trans="${escapeHtml(language.code)}">
        ${option('', '不限')}
        ${option('filled', '已填译文')}
        ${option('missing', '未填译文')}
      </select>
    </label>`;
  }).join('');
}

// ---- 文案列表与筛选 --------------------------------------------------------

function buildEntryQuery() {
  const params = new URLSearchParams();
  const { module, groupId, keyword, tagIds, trans } = state.filters;
  if (module) params.set('module', module);
  if (groupId) params.set('groupId', groupId);
  if (keyword.trim()) params.set('keyword', keyword.trim());
  tagIds.forEach((tagId) => params.append('tag', tagId));
  trans.forEach((expects, code) => params.append('trans', `${code}:${expects}`));
  params.set('limit', String(state.page.limit));
  params.set('offset', String(state.page.offset));
  return params.toString();
}

async function loadEntries() {
  const payload = await request(`/api/entries?${buildEntryQuery()}`);
  state.entries = payload.entries || [];
  state.modules = payload.modules || [];
  state.page.total = payload.total || 0;
  state.page.limit = payload.limit || state.page.limit;
  state.page.offset = payload.offset || 0;
  // 数据变少导致当前页整体越过末尾时，回到第一页重拉一次，避免出现空白页
  if (!state.entries.length && state.page.total > 0 && state.page.offset > 0) {
    state.page.offset = 0;
    return loadEntries();
  }
  renderModules();
  renderEntries();
  renderPagination();
}

// 筛选用的模块下拉与标签管理模块下拉共用一份模块清单
function renderModules() {
  const select = el('filter-module');
  const current = state.filters.module;
  select.innerHTML = ['<option value="">全部模块</option>']
    .concat(state.modules.map((item) => `<option value="${escapeHtml(item.module)}">${escapeHtml(item.module)}（${item.count}）</option>`))
    .join('');
  select.value = current;
  renderTagManager();
  renderTagFilterPanel();
}

function renderLanguages() {
  const body = el('language-body');
  body.innerHTML = state.languages.map((item) => {
    const defaultTag = item.isDefault ? '<span class="tag on">默认</span>' : '';
    const enabledTag = item.enabled ? '<span class="tag on">已启用</span>' : '<span class="tag off">已停用</span>';
    const actions = [
      `<button type="button" class="link" data-language-default="${escapeHtml(item.code)}"${item.isDefault ? ' disabled' : ''}>设为默认</button>`,
      `<button type="button" class="link" data-language-toggle="${escapeHtml(item.code)}">${item.enabled ? '停用' : '启用'}</button>`,
      `<button type="button" class="link" data-language-rename="${escapeHtml(item.code)}">改名</button>`,
      `<button type="button" class="link danger" data-language-delete="${escapeHtml(item.code)}">删除</button>`,
    ];
    return `<tr${item.enabled ? '' : ' class="muted"'}>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${defaultTag}</td>
      <td>${enabledTag}</td>
      <td>${item.filled} 条</td>
      <td class="actions">${actions.join('')}</td>
    </tr>`;
  }).join('');
  el('language-empty').classList.toggle('hidden', state.languages.length > 0);
}

// 新建文案的表单按当前登记的语言逐条生成译文输入框，停用的语言照样可以查看与补填
function renderTranslationInputs(values) {
  const box = el('entry-translations');
  const current = values || collectTranslations();
  box.innerHTML = state.languages.map((item) => {
    const value = current[item.code] === undefined ? '' : current[item.code];
    const suffix = item.enabled ? '' : '<span class="tag off">已停用</span>';
    return `<label class="translation" data-field="translations.${escapeHtml(item.code)}">
      <span>${escapeHtml(item.code)} ${suffix}</span>
      <input class="translation-input" data-code="${escapeHtml(item.code)}" maxlength="200" value="${escapeHtml(value)}">
    </label>`;
  }).join('');
}

function collectTranslations() {
  const result = {};
  document.querySelectorAll('.translation-input').forEach((input) => {
    result[input.dataset.code] = input.value;
  });
  return result;
}

// 文案表单里当前模块的标签勾选清单；已勾选的状态尽量保留
function renderEntryTagChecks(selectedIds) {
  const box = el('entry-tag-list');
  const module = el('entry-module').value.trim();
  const selected = selectedIds instanceof Set
    ? selectedIds
    : new Set(Array.from(box.querySelectorAll('input[data-entry-tag]:checked')).map((input) => input.value));
  const tags = module ? tagsOfModule(module) : [];
  if (!tags.length) {
    box.innerHTML = '<span class="tag-manager-empty">这个模块还没有标签，可以在下面直接新建</span>';
    return;
  }
  box.innerHTML = tags.map((tag) => {
    const checked = selected.has(tag.id) ? ' checked' : '';
    return `<label class="check tag-check"><input type="checkbox" data-entry-tag="${escapeHtml(tag.id)}" value="${escapeHtml(tag.id)}"${checked}> ${escapeHtml(tag.name)}</label>`;
  }).join('');
}

function tagNameMap() {
  const map = new Map();
  state.tags.forEach((tag) => map.set(tag.id, tag));
  return map;
}

function renderEntries() {
  const head = el('entry-head-row');
  head.innerHTML = ['模块', '分组', '文案键', '标签']
    .concat(state.languages.map((item) => item.code))
    .concat(['备注', '最近改动人', '更新时间', '操作'])
    .map((text) => `<th>${escapeHtml(text)}</th>`)
    .join('');

  const tagMap = tagNameMap();
  const body = el('entry-body');
  body.innerHTML = state.entries.map((item) => {
    const cells = state.languages.map((language) => {
      const value = item.translations[language.code];
      if (value === undefined) return '<td class="missing">未登记</td>';
      if (!value.trim()) return '<td class="missing">待翻译</td>';
      return `<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
    });
    const tagChips = item.tags.map((tagId) => {
      const tag = tagMap.get(tagId);
      return tag ? `<span class="tag-chip static">${escapeHtml(tag.name)}</span>` : '';
    }).join('');
    return `<tr>
      <td class="mono">${escapeHtml(item.module)}</td>
      <td class="group-cell">${item.groupId ? escapeHtml(groupFullName(item.groupId)) : '<span class="missing">未分组</span>'}</td>
      <td class="mono">${escapeHtml(item.key)}</td>
      <td class="tag-cell">${tagChips}</td>
      ${cells.join('')}
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td>${escapeHtml(item.updatedBy)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-entry-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-entry-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('entry-empty').classList.toggle('hidden', state.entries.length > 0);

  const { total, limit, offset } = state.page;
  el('result-tip').textContent = total ? `共 ${total} 条，当前第 ${offset + 1}–${offset + state.entries.length} 条` : '';
}

function renderPagination() {
  const pager = el('pager');
  const { total, limit, offset } = state.page;
  pager.classList.toggle('hidden', total === 0);
  el('page-prev').disabled = offset === 0;
  el('page-next').disabled = offset + state.entries.length >= total;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  el('page-info').textContent = `第 ${currentPage} / ${totalPages} 页`;
  el('page-size').value = String(limit);
}

// 从界面收集筛选条件
function syncFiltersFromInputs() {
  state.filters.module = el('filter-module').value;
  state.filters.groupId = el('filter-group').value;
  state.filters.keyword = el('filter-keyword').value;
}

function resetFilters() {
  state.filters.module = '';
  state.filters.groupId = '';
  state.filters.keyword = '';
  state.filters.tagIds = new Set();
  state.filters.trans = new Map();
  el('filter-module').value = '';
  el('filter-group').value = '';
  el('filter-keyword').value = '';
  renderTagFilterPanel();
  renderTransFilterPanel();
}

async function applyFilters() {
  clearNotice();
  state.page.offset = 0;
  syncFiltersFromInputs();
  try {
    await loadEntries();
  } catch (err) {
    notify(err.message, 'error');
  }
}

// 各区块的字段名撞车（语言、分组、标签都用 name），按当前动作把错误位置标到对应表单
function markScopedField(field, scope) {
  if (!field) return;
  if (scope === 'group' && field === 'name') return markField('groupName');
  if (scope === 'tag') {
    if (field === 'name') return markField('tagName');
    if (field === 'module') return el('tag-module').focus();
  }
  if (scope === 'quickTag' && field === 'name') {
    el('entry-tag-new').classList.add('invalid');
    el('entry-tag-new').focus();
    return;
  }
  markField(field);
}

// ---- 文案表单 --------------------------------------------------------------

function openEntryForm(entry) {
  state.editingId = entry ? entry.id : '';
  el('entry-form-title').textContent = entry ? `编辑文案：${entry.key}` : '新建文案';
  el('entry-module').value = entry ? entry.module : '';
  el('entry-key').value = entry ? entry.key : '';
  el('entry-group').value = entry && entry.groupId ? entry.groupId : '';
  el('entry-note').value = entry ? entry.note : '';
  el('entry-translations').innerHTML = '';
  renderTranslationInputs(entry ? entry.translations : {});
  renderEntryTagChecks(new Set(entry ? entry.tags : []));
  el('entry-form').classList.remove('hidden');
  el('entry-module').focus();
}

function closeEntryForm() {
  state.editingId = '';
  el('entry-form').classList.add('hidden');
  clearFieldMarks();
}

async function submitLanguage(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('language-code').value,
    name: el('language-name').value,
    enabled: el('language-enabled').checked,
    isDefault: el('language-default').checked,
  };
  try {
    await request('/api/languages', { method: 'POST', body: JSON.stringify(payload) });
    el('language-code').value = '';
    el('language-name').value = '';
    el('language-default').checked = false;
    notify('语言已新增', 'ok');
    await loadLanguages();
    await loadEntries();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitEntry(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const tags = Array.from(document.querySelectorAll('input[data-entry-tag]:checked')).map((input) => input.value);
  const payload = {
    module: el('entry-module').value,
    key: el('entry-key').value,
    groupId: el('entry-group').value,
    tags,
    note: el('entry-note').value,
    operator: currentOperator(),
    translations: collectTranslations(),
  };
  const editing = state.editingId;
  try {
    if (editing) {
      await request(`/api/entries/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('文案已保存', 'ok');
    } else {
      await request('/api/entries', { method: 'POST', body: JSON.stringify(payload) });
      notify('文案已新增', 'ok');
    }
    closeEntryForm();
    await Promise.all([loadEntries(), loadLanguages(), loadGroups()]);
    await loadTags();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitGroup(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  try {
    await request('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name: el('group-name').value, parentId: null }),
    });
    el('group-name').value = '';
    notify('分组已新增', 'ok');
    await loadGroups();
  } catch (err) {
    notify(err.message, 'error');
    markScopedField(err.field, 'group');
  }
}

async function submitTag(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const module = el('tag-module').value;
  if (!module) {
    notify('请先在文案筛选里选一个模块，或先新建这个模块的文案', 'error');
    return;
  }
  try {
    await request('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ module, name: el('tag-name').value }),
    });
    el('tag-name').value = '';
    notify('标签已新增', 'ok');
    await loadTags();
  } catch (err) {
    notify(err.message, 'error');
    markScopedField(err.field, 'tag');
  }
}

// 文案表单里的快速建标签：建好后立即勾上
async function quickAddEntryTag() {
  clearNotice();
  const module = el('entry-module').value.trim();
  const name = el('entry-tag-new').value.trim();
  if (!module) {
    notify('请先填写模块，再给这个模块新建标签', 'error');
    markField('module');
    return;
  }
  if (!name) return;
  try {
    const created = await request('/api/tags', { method: 'POST', body: JSON.stringify({ module, name }) });
    el('entry-tag-new').value = '';
    const checked = new Set(Array.from(document.querySelectorAll('input[data-entry-tag]:checked')).map((input) => input.value));
    checked.add(created.id);
    await loadTags();
    renderEntryTagChecks(checked);
    notify(`标签“${created.name}”已新建并勾选`, 'ok');
  } catch (err) {
    notify(err.message, 'error');
    markScopedField(err.field, 'quickTag');
  }
}

// ---- 分组操作：加子分组、改名、上下移动、换父分组、删除 ----------------------

async function addChildGroup(rootId) {
  const name = window.prompt('子分组名称', '');
  if (name === null) return;
  try {
    await request('/api/groups', { method: 'POST', body: JSON.stringify({ name, parentId: rootId }) });
    notify('子分组已新增', 'ok');
    await loadGroups();
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function renameGroup(id) {
  const group = groupById(id);
  const name = window.prompt('把分组名改成', group ? group.name : '');
  if (name === null) return;
  try {
    await request(`/api/groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    notify('分组已改名', 'ok');
    await loadGroups();
  } catch (err) {
    notify(err.message, 'error');
  }
}

// 上移/下移：算出新位置前面紧挨着的同层分组 id（afterId），交给服务端落盘
async function moveGroupSibling(id, direction) {
  const group = groupById(id);
  if (!group) return;
  const siblings = state.groups.filter((item) => item.parentId === group.parentId);
  const index = siblings.findIndex((item) => item.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= siblings.length) return;
  const afterId = direction === 'up'
    ? (target - 1 >= 0 ? siblings[target - 1].id : null)
    : siblings[target].id;
  try {
    await request(`/api/groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ afterId }),
    });
    await loadGroups();
  } catch (err) {
    notify(err.message, 'error');
  }
}

// 换父分组：服务端会当场拒绝挪进自己或自己的子分组，以及超过两级的情况
async function moveGroupParent(id, rawValue) {
  if (!rawValue) return;
  const payload = rawValue === '__top__' ? { parentId: null } : { parentId: rawValue };
  try {
    await request(`/api/groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    notify('分组已移动，新的父子关系与顺序已保存', 'ok');
    await Promise.all([loadGroups(), loadEntries()]);
  } catch (err) {
    notify(err.message, 'error');
    await loadGroups();
  }
}

async function deleteGroup(id) {
  const group = groupById(id);
  const childCount = state.groups.filter((item) => item.parentId === id).length;
  const extra = childCount ? `它下面的 ${childCount} 个子分组会提升为一级分组。` : '';
  if (!window.confirm(`确定删除分组“${group ? group.name : ''}”吗？${extra}组内文案不会删除，会变为“未分组”。`)) return;
  try {
    await request(`/api/groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (state.filters.groupId === id) state.filters.groupId = '';
    notify('分组已删除，文案保留为未分组', 'ok');
    await Promise.all([loadGroups(), loadEntries()]);
  } catch (err) {
    notify(err.message, 'error');
  }
}

// ---- 标签操作：改名、删除（只摘标签，不删文案） ----------------------------

async function renameTag(id) {
  const tag = state.tags.find((item) => item.id === id);
  const name = window.prompt(`把 ${tag ? tag.module : ''} 模块的标签名改成`, tag ? tag.name : '');
  if (name === null) return;
  try {
    await request(`/api/tags/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    notify('标签已改名', 'ok');
    await Promise.all([loadTags(), loadEntries()]);
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function deleteTag(id) {
  const tag = state.tags.find((item) => item.id === id);
  if (!window.confirm(`确定删除标签“${tag ? tag.name : ''}”吗？只会把这个标签从文案上摘掉，不会删除任何文案。`)) return;
  try {
    await request(`/api/tags/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.filters.tagIds.delete(id);
    notify('标签已删除，相关文案上的标签已一并摘掉', 'ok');
    await Promise.all([loadTags(), loadEntries()]);
  } catch (err) {
    notify(err.message, 'error');
  }
}

// ---- 事件委托 --------------------------------------------------------------

document.addEventListener('click', async (event) => {
  // 下拉面板：点开关切换，点面板外面收起
  const toggle = event.target.closest('#filter-tag-toggle, #filter-trans-toggle');
  if (toggle) {
    const panelId = toggle.id === 'filter-tag-toggle' ? 'filter-tag-panel' : 'filter-trans-panel';
    el(panelId).classList.toggle('hidden');
    event.stopPropagation();
    return;
  }
  if (!event.target.closest('.dropdown-panel')) {
    el('filter-tag-panel').classList.add('hidden');
    el('filter-trans-panel').classList.add('hidden');
  }

  const node = event.target.closest('button');
  if (!node) return;

  const code = node.dataset.languageDefault || node.dataset.languageToggle
    || node.dataset.languageRename || node.dataset.languageDelete;
  if (code) {
    clearNotice();
    try {
      if (node.dataset.languageDefault) {
        await request(`/api/languages/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) });
        notify(`${code} 已设为默认语言`, 'ok');
      } else if (node.dataset.languageToggle) {
        const target = state.languages.find((item) => item.code === code);
        await request(`/api/languages/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !target.enabled }) });
        notify(`${code} 已${target.enabled ? '停用' : '启用'}`, 'ok');
      } else if (node.dataset.languageRename) {
        const target = state.languages.find((item) => item.code === code);
        const next = window.prompt(`把 ${code} 的名称改成`, target ? target.name : '');
        if (next === null) return;
        await request(`/api/languages/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
        notify(`${code} 的名称已更新`, 'ok');
      } else {
        if (!window.confirm(`确定删除语言 ${code} 吗？`)) return;
        await request(`/api/languages/${encodeURIComponent(code)}`, { method: 'DELETE' });
        notify(`${code} 已删除`, 'ok');
      }
      await loadLanguages();
      await loadEntries();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.groupAddchild) return addChildGroup(node.dataset.groupAddchild);
  if (node.dataset.groupRename) return renameGroup(node.dataset.groupRename);
  if (node.dataset.groupUp) return moveGroupSibling(node.dataset.groupUp, 'up');
  if (node.dataset.groupDown) return moveGroupSibling(node.dataset.groupDown, 'down');
  if (node.dataset.groupDelete) return deleteGroup(node.dataset.groupDelete);
  if (node.dataset.tagRename) return renameTag(node.dataset.tagRename);
  if (node.dataset.tagDelete) return deleteTag(node.dataset.tagDelete);

  if (node.dataset.entryEdit) {
    clearNotice();
    const found = state.entries.find((item) => item.id === node.dataset.entryEdit);
    if (found) openEntryForm(found);
    return;
  }

  if (node.dataset.entryDelete) {
    clearNotice();
    const found = state.entries.find((item) => item.id === node.dataset.entryDelete);
    if (!window.confirm(`确定删除文案 ${found ? found.key : ''} 吗？`)) return;
    try {
      await request(`/api/entries/${encodeURIComponent(node.dataset.entryDelete)}`, { method: 'DELETE' });
      if (state.editingId === node.dataset.entryDelete) closeEntryForm();
      notify('文案已删除', 'ok');
      await Promise.all([loadEntries(), loadLanguages(), loadGroups()]);
      await loadTags();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

// 下拉面板里的勾选与下拉变化不方便用 click 委托，单独用 change 委托
document.addEventListener('change', async (event) => {
  const tagCheckbox = event.target.dataset && event.target.dataset.filterTag;
  if (tagCheckbox !== undefined) {
    if (event.target.checked) state.filters.tagIds.add(tagCheckbox);
    else state.filters.tagIds.delete(tagCheckbox);
    return;
  }
  const transSelect = event.target.dataset && event.target.dataset.filterTrans;
  if (transSelect !== undefined) {
    if (event.target.value) state.filters.trans.set(transSelect, event.target.value);
    else state.filters.trans.delete(transSelect);
    return;
  }
  const groupMove = event.target.dataset && event.target.dataset.groupMove;
  if (groupMove !== undefined) {
    const value = event.target.value;
    event.target.value = '';
    if (value) await moveGroupParent(groupMove, value);
  }
});

el('language-form').addEventListener('submit', submitLanguage);
el('group-form').addEventListener('submit', submitGroup);
el('tag-form').addEventListener('submit', submitTag);
el('entry-tag-add').addEventListener('click', quickAddEntryTag);
el('entry-form').addEventListener('submit', submitEntry);

el('entry-new').addEventListener('click', () => {
  clearNotice();
  openEntryForm(null);
});
el('entry-cancel').addEventListener('click', closeEntryForm);

el('filter-apply').addEventListener('click', applyFilters);
el('filter-keyword').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    applyFilters();
  }
});
el('filter-reset').addEventListener('click', () => {
  resetFilters();
  state.page.offset = 0;
  loadEntries().catch((err) => notify(err.message, 'error'));
});
el('entry-refresh').addEventListener('click', () => {
  clearNotice();
  Promise.all([loadLanguages(), loadGroups(), loadTags(), loadEntries()])
    .catch((err) => notify(err.message, 'error'));
});
el('filter-module').addEventListener('change', () => {
  // 切换模块后，标签只列这个模块的；之前选的跨模块标签清空，避免筛不出东西
  state.filters.tagIds = new Set();
  applyFilters();
});
el('filter-group').addEventListener('change', applyFilters);
el('tag-module').addEventListener('change', renderTagManager);
el('entry-module').addEventListener('input', () => renderEntryTagChecks());

el('page-prev').addEventListener('click', () => {
  state.page.offset = Math.max(0, state.page.offset - state.page.limit);
  loadEntries().catch((err) => notify(err.message, 'error'));
});
el('page-next').addEventListener('click', () => {
  state.page.offset += state.page.limit;
  loadEntries().catch((err) => notify(err.message, 'error'));
});
el('page-size').addEventListener('change', (event) => {
  state.page.limit = Number(event.target.value) || 100;
  state.page.offset = 0;
  window.localStorage.setItem(PAGE_SIZE_KEY, String(state.page.limit));
  loadEntries().catch((err) => notify(err.message, 'error'));
});

el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把语言、分组、标签拉一遍，语言决定文案表格里有哪些列
restoreOperator();
state.page.limit = Number(window.localStorage.getItem(PAGE_SIZE_KEY)) || state.page.limit;
el('page-size').value = String(state.page.limit);
loadHealth();
Promise.all([loadLanguages(), loadGroups(), loadTags()])
  .then(loadEntries)
  .catch((err) => notify(err.message, 'error'));
