const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const TEMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

const MAX_TRANSLATION_LENGTH = 200;
const MAX_NOTE_LENGTH = 200;
const MAX_OPERATOR_LENGTH = 40;
const MAX_GROUP_NAME_LENGTH = 30;
const MAX_TAG_NAME_LENGTH = 20;
const MAX_ENTRY_TAGS = 20;
const UNNAMED = '未署名';

// 初始数据：四种语言、四个模块的十五条文案。繁体与英语故意留了几条没译，
// 日语整条语言处于停用状态，英语里还有一条把 {minutes} 占位符写丢了。
// 分组最多两级：home 模块下「页面」是一级分组，「轮播横幅」挂在它下面。
function seedData() {
  return {
    languages: [
      { code: 'zh-CN', name: '简体中文', enabled: true, isDefault: true, createdAt: '2026-09-05T01:00:00.000Z' },
      { code: 'zh-TW', name: '繁体中文', enabled: true, isDefault: false, createdAt: '2026-09-05T01:05:00.000Z' },
      { code: 'en-US', name: '英语（美国）', enabled: true, isDefault: false, createdAt: '2026-09-05T01:10:00.000Z' },
      { code: 'ja-JP', name: '日语', enabled: false, isDefault: false, createdAt: '2026-09-05T01:15:00.000Z' },
    ],
    groups: [
      { id: 'group-home-page', module: 'home', name: '页面', parentId: '', order: 0, createdAt: '2026-09-07T01:00:00.000Z', updatedAt: '2026-09-07T01:00:00.000Z' },
      { id: 'group-home-banner', module: 'home', name: '轮播横幅', parentId: 'group-home-page', order: 0, createdAt: '2026-09-07T01:05:00.000Z', updatedAt: '2026-09-07T01:05:00.000Z' },
      { id: 'group-home-search', module: 'home', name: '搜索', parentId: '', order: 1, createdAt: '2026-09-07T01:10:00.000Z', updatedAt: '2026-09-07T01:10:00.000Z' },
      { id: 'group-common-ui', module: 'common', name: '按钮与提示', parentId: '', order: 0, createdAt: '2026-09-07T01:15:00.000Z', updatedAt: '2026-09-07T01:15:00.000Z' },
    ],
    tags: [
      { id: 'tag-home-promo', module: 'home', name: '促销', createdAt: '2026-09-07T02:00:00.000Z', updatedAt: '2026-09-07T02:00:00.000Z' },
      { id: 'tag-home-placeholder', module: 'home', name: '占位提示', createdAt: '2026-09-07T02:05:00.000Z', updatedAt: '2026-09-07T02:05:00.000Z' },
      { id: 'tag-common-btn', module: 'common', name: '按钮', createdAt: '2026-09-07T02:10:00.000Z', updatedAt: '2026-09-07T02:10:00.000Z' },
    ],
    entries: [
      {
        id: 'entry-1001',
        module: 'home',
        key: 'home.banner.title',
        groupId: 'group-home-banner',
        tagIds: ['tag-home-promo'],
        translations: {
          'zh-CN': '限时折扣，精选好物直降',
          'zh-TW': '限時折扣，精選好物直降',
          'en-US': 'Limited-time deals on selected items',
        },
        note: '首页顶部轮播主标题',
        updatedBy: '陈晓',
        createdAt: '2026-09-08T02:10:00.000Z',
        updatedAt: '2026-09-16T09:30:00.000Z',
      },
      {
        id: 'entry-1002',
        module: 'home',
        key: 'home.banner.subtitle',
        groupId: 'group-home-banner',
        tagIds: [],
        translations: {
          'zh-CN': '单笔满{amount}元包邮',
          'en-US': 'Free shipping on orders over {amount}',
        },
        note: '首页顶部轮播副标题',
        updatedBy: '李文',
        createdAt: '2026-09-08T02:12:00.000Z',
        updatedAt: '2026-09-16T09:32:00.000Z',
      },
      {
        id: 'entry-1003',
        module: 'home',
        key: 'home.search.placeholder',
        groupId: 'group-home-search',
        tagIds: ['tag-home-placeholder'],
        translations: {
          'zh-CN': '搜索商品或品牌',
          'zh-TW': '搜尋商品或品牌',
          'en-US': 'Search products or brands',
          'ja-JP': '商品やブランドを検索',
        },
        note: '首页搜索框占位提示',
        updatedBy: '王凯',
        createdAt: '2026-09-08T02:20:00.000Z',
        updatedAt: '2026-09-15T11:05:00.000Z',
      },
      {
        id: 'entry-1004',
        module: 'home',
        key: 'home.empty.tip',
        groupId: 'group-home-search',
        tagIds: [],
        translations: {
          'zh-CN': '换个关键词再试试',
          'en-US': 'Try another keyword',
        },
        note: '搜索无结果时的提示',
        updatedBy: '陈晓',
        createdAt: '2026-09-09T03:40:00.000Z',
        updatedAt: '2026-09-15T11:20:00.000Z',
      },
      {
        id: 'entry-1005',
        module: 'order',
        key: 'order.confirm.title',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '确认订单',
          'zh-TW': '確認訂單',
          'en-US': 'Confirm order',
        },
        note: '下单确认页标题',
        updatedBy: '李文',
        createdAt: '2026-09-09T04:00:00.000Z',
        updatedAt: '2026-09-14T06:15:00.000Z',
      },
      {
        id: 'entry-1006',
        module: 'order',
        key: 'order.confirm.itemCount',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '共{count}件商品',
          'zh-TW': '共{count}件商品',
          'en-US': '{count} items in total',
        },
        note: '下单确认页商品件数',
        updatedBy: '李文',
        createdAt: '2026-09-09T04:05:00.000Z',
        updatedAt: '2026-09-14T06:18:00.000Z',
      },
      {
        id: 'entry-1007',
        module: 'order',
        key: 'order.detail.payTip',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '请在{minutes}分钟内完成支付',
          'zh-TW': '請在{minutes}分鐘內完成支付',
          'en-US': 'Please complete the payment within 30 minutes',
        },
        note: '订单详情页支付倒计时提示',
        updatedBy: '王凯',
        createdAt: '2026-09-09T04:20:00.000Z',
        updatedAt: '2026-09-16T02:45:00.000Z',
      },
      {
        id: 'entry-1008',
        module: 'order',
        key: 'order.status.pending',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '待付款',
          'zh-TW': '待付款',
          'en-US': 'Pending payment',
        },
        note: '订单状态标签',
        updatedBy: '陈晓',
        createdAt: '2026-09-10T01:30:00.000Z',
        updatedAt: '2026-09-16T02:50:00.000Z',
      },
      {
        id: 'entry-1009',
        module: 'account',
        key: 'account.login.title',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '登录账号',
          'zh-TW': '登入帳號',
          'en-US': 'Sign in',
        },
        note: '登录页标题',
        updatedBy: '李文',
        createdAt: '2026-09-10T05:00:00.000Z',
        updatedAt: '2026-09-13T08:00:00.000Z',
      },
      {
        id: 'entry-1010',
        module: 'account',
        key: 'account.login.placeholder',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '手机号或邮箱',
          'en-US': 'Phone number or email',
        },
        note: '登录页账号输入框占位提示',
        updatedBy: '王凯',
        createdAt: '2026-09-10T05:02:00.000Z',
        updatedAt: '2026-09-13T08:05:00.000Z',
      },
      {
        id: 'entry-1011',
        module: 'account',
        key: 'account.register.agree',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '我已阅读并同意{link}',
          'en-US': '',
        },
        note: '注册页协议勾选文案，{link} 由前端替换成协议链接',
        updatedBy: '陈晓',
        createdAt: '2026-09-11T05:30:00.000Z',
        updatedAt: '2026-09-13T08:20:00.000Z',
      },
      {
        id: 'entry-1012',
        module: 'common',
        key: 'common.action.confirm',
        groupId: 'group-common-ui',
        tagIds: ['tag-common-btn'],
        translations: {
          'zh-CN': '确定',
          'zh-TW': '確定',
          'en-US': 'OK',
        },
        note: '通用确认按钮',
        updatedBy: '王凯',
        createdAt: '2026-09-11T06:00:00.000Z',
        updatedAt: '2026-09-12T03:10:00.000Z',
      },
      {
        id: 'entry-1013',
        module: 'common',
        key: 'common.action.cancel',
        groupId: 'group-common-ui',
        tagIds: ['tag-common-btn'],
        translations: {
          'zh-CN': '取消',
          'zh-TW': '取消',
          'en-US': 'Cancel',
        },
        note: '通用取消按钮',
        updatedBy: '王凯',
        createdAt: '2026-09-07T06:02:00.000Z',
        updatedAt: '2026-09-12T03:12:00.000Z',
      },
      {
        id: 'entry-1014',
        module: 'common',
        key: 'common.error.network',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '网络开小差了，请稍后重试',
          'zh-TW': '網絡開小差了，請稍後重試',
          'en-US': 'Network error, please try again later',
        },
        note: '通用网络异常提示',
        updatedBy: '李文',
        createdAt: '2026-09-11T06:10:00.000Z',
        updatedAt: '2026-09-12T03:20:00.000Z',
      },
      {
        id: 'entry-1015',
        module: 'common',
        key: 'common.loading.text',
        groupId: '',
        tagIds: [],
        translations: {
          'zh-CN': '正在加载',
          'zh-TW': '正在載入',
          'en-US': 'Loading',
        },
        note: '通用加载中提示',
        updatedBy: '陈晓',
        createdAt: '2026-09-11T06:15:00.000Z',
        updatedAt: '2026-09-12T03:25:00.000Z',
      },
    ],
  };
}

// 把单条语言整理成固定结构，避免数据文件被手工改动后出现缺字段
function normalizeLanguage(item, fallbackIndex) {
  const source = item && typeof item === 'object' ? item : {};
  const code = typeof source.code === 'string' && source.code.trim() ? source.code.trim() : `lang-${fallbackIndex + 1}`;
  return {
    code,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : code,
    enabled: source.enabled !== false,
    isDefault: source.isDefault === true,
    createdAt: typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : new Date().toISOString(),
  };
}

// 分组先做单条整理：层级关系在 normalizeGroups 里统一修正，保证最多两级
function normalizeGroup(item, fallbackIndex, stamp) {
  const source = item && typeof item === 'object' ? item : {};
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `group-restored-${fallbackIndex + 1}`;
  const module = typeof source.module === 'string' && source.module.trim() ? source.module.trim() : 'default';
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim().slice(0, MAX_GROUP_NAME_LENGTH)
    : `未命名分组${fallbackIndex + 1}`;
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : stamp;
  return {
    id,
    module,
    name,
    parentId: typeof source.parentId === 'string' ? source.parentId : '',
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : fallbackIndex,
    createdAt,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt,
  };
}

function normalizeTag(item, fallbackIndex, stamp) {
  const source = item && typeof item === 'object' ? item : {};
  const id = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : `tag-restored-${fallbackIndex + 1}`;
  const module = typeof source.module === 'string' && source.module.trim() ? source.module.trim() : 'default';
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim().slice(0, MAX_TAG_NAME_LENGTH)
    : `未命名标签${fallbackIndex + 1}`;
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : stamp;
  return {
    id,
    module,
    name,
    createdAt,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt,
  };
}

// 分组整段修正：id 去重、只保留两级、同模块同层重名加后缀、兄弟顺序重新编号
function normalizeGroups(rawGroups, stamp) {
  const list = Array.isArray(rawGroups) ? rawGroups : [];
  const byId = new Map();
  const groups = [];
  list.forEach((item, index) => {
    const group = normalizeGroup(item, index, stamp);
    if (byId.has(group.id)) {
      group.id = `group-restored-${index + 1}-${groups.length + 1}`;
    }
    if (byId.has(group.id)) return;
    byId.set(group.id, group);
    groups.push(group);
  });

  // 父分组必须存在、同属一个模块且本身是一级分组；不满足时直接提到最外层，
  // 这样任何深度的数据读进来都稳定落在两级结构里
  groups.forEach((group) => {
    if (!group.parentId) {
      group.parentId = '';
      return;
    }
    if (group.parentId === group.id) {
      group.parentId = '';
      return;
    }
    const parent = byId.get(group.parentId);
    if (!parent || parent.module !== group.module || parent.parentId !== '') {
      group.parentId = '';
    }
  });

  // 同模块、同一层下名字唯一；保留先出现的一个，后面的追加序号
  const nameSeen = new Map();
  groups.forEach((group) => {
    const key = `${group.module} ${group.parentId} ${group.name}`;
    if (!nameSeen.has(key)) {
      nameSeen.set(key, 1);
      return;
    }
    const next = nameSeen.get(key) + 1;
    nameSeen.set(key, next);
    let candidate = `${group.name}（${next}）`;
    if (candidate.length > MAX_GROUP_NAME_LENGTH) {
      candidate = `${group.name.slice(0, MAX_GROUP_NAME_LENGTH - 4)}（${next}）`;
    }
    group.name = candidate;
  });

  // 兄弟之间按原 order 稳定排序后重新连续编号，先后顺序固定写进数据
  const buckets = new Map();
  groups.forEach((group) => {
    const key = `${group.module} ${group.parentId}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(group);
  });
  buckets.forEach((siblings) => {
    siblings
      .sort((a, b) => (a.order - b.order) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : 1))
      .forEach((group, index) => {
        group.order = index;
      });
  });

  return groups;
}

// 标签整段修正：id 去重，同一模块内同名标签只保留一个
function normalizeTags(rawTags, stamp) {
  const list = Array.isArray(rawTags) ? rawTags : [];
  const seen = new Set();
  const tags = [];
  list.forEach((item, index) => {
    const tag = normalizeTag(item, index, stamp);
    if (seen.has(tag.id)) tag.id = `tag-restored-${index + 1}-${tags.length + 1}`;
    if (seen.has(tag.id)) return;
    seen.add(tag.id);
    const nameKey = `${tag.module} ${tag.name}`;
    if (tags.some((other) => other.module === tag.module && other.name === tag.name)) return;
    tags.push(tag);
  });
  return tags;
}

// 把单条文案整理成固定结构：译文只保留字符串取值，其余一律丢弃
function normalizeEntry(item, fallbackIndex) {
  const source = item && typeof item === 'object' ? item : {};
  const createdAt = typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : new Date().toISOString();
  const translations = {};
  if (source.translations && typeof source.translations === 'object' && !Array.isArray(source.translations)) {
    Object.keys(source.translations).forEach((code) => {
      const value = source.translations[code];
      if (typeof value === 'string') translations[code] = value;
    });
  }
  const tagIds = Array.isArray(source.tagIds)
    ? source.tagIds.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
    : [];
  return {
    id: typeof source.id === 'string' && source.id ? source.id : `entry-restored-${fallbackIndex + 1}`,
    module: typeof source.module === 'string' && source.module.trim() ? source.module.trim() : 'default',
    key: typeof source.key === 'string' && source.key.trim() ? source.key.trim() : `entry.restored.${fallbackIndex + 1}`,
    groupId: typeof source.groupId === 'string' ? source.groupId : '',
    tagIds,
    translations,
    note: typeof source.note === 'string' ? source.note : '',
    updatedBy: typeof source.updatedBy === 'string' && source.updatedBy.trim() ? source.updatedBy.trim() : UNNAMED,
    createdAt,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : createdAt,
  };
}

// 整份数据保证 languages/groups/tags/entries 结构一致；默认语言有且只有一个
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const seed = seedData();
  const stamp = new Date().toISOString();

  // 旧数据文件里没有 languages 这一段时补上种子语言，显式写成空数组时尊重用户的清空动作
  const languages = Array.isArray(source.languages)
    ? source.languages.map((item, index) => normalizeLanguage(item, index))
    : seed.languages;

  const seenCodes = new Set();
  const dedupedLanguages = [];
  languages.forEach((item) => {
    const lower = item.code.toLowerCase();
    if (seenCodes.has(lower)) return;
    seenCodes.add(lower);
    dedupedLanguages.push(item);
  });

  if (dedupedLanguages.length) {
    const defaultIndex = dedupedLanguages.findIndex((item) => item.isDefault);
    const keep = defaultIndex === -1 ? 0 : defaultIndex;
    dedupedLanguages.forEach((item, index) => {
      item.isDefault = index === keep;
    });
    // 默认语言必须处于启用状态，否则前端一进来就没有可填写的语言
    dedupedLanguages[keep].enabled = true;
  }

  const known = new Set(dedupedLanguages.map((item) => item.code));
  // 旧版本数据没有 groups/tags 字段：补一套种子组织方式，并按文案 id 关联，
  // 让升级前的数据一打开就能看到分组与标签；显式写成空数组时尊重用户的清空动作
  const seedGroups = Array.isArray(source.groups) ? null : seed.groups;
  const seedTags = Array.isArray(source.tags) ? null : seed.tags;
  const groups = normalizeGroups(seedGroups || (Array.isArray(source.groups) ? source.groups : []), stamp);
  const tags = normalizeTags(seedTags || (Array.isArray(source.tags) ? source.tags : []), stamp);
  const seedEntryOrg = new Map(seed.entries.map((item) => [item.id, { groupId: item.groupId, tagIds: item.tagIds }]));

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const seenEntries = new Set();

  const entries = (Array.isArray(source.entries) ? source.entries : [])
    .map((item, index) => {
      const normalized = normalizeEntry(item, index);
      // 旧版本条目本身没有 groupId/tagIds 字段：按 id 套用种子归属
      if (item && typeof item === 'object'
        && !Object.prototype.hasOwnProperty.call(item, 'groupId')
        && !Object.prototype.hasOwnProperty.call(item, 'tagIds')
        && seedEntryOrg.has(normalized.id)) {
        const org = seedEntryOrg.get(normalized.id);
        normalized.groupId = org.groupId;
        normalized.tagIds = org.tagIds.slice();
      }
      return normalized;
    })
    .filter((item) => {
      if (!item.id || seenEntries.has(item.id)) return false;
      seenEntries.add(item.id);
      return true;
    })
    .map((item) => {
      const kept = {};
      Object.keys(item.translations).forEach((code) => {
        if (known.has(code)) kept[code] = item.translations[code];
      });
      // 分组必须在同一模块里，标签必须属于同一模块；对不上的引用一律摘掉但保留文案
      const group = item.groupId ? groupById.get(item.groupId) : null;
      const groupId = group && group.module === item.module ? group.id : '';
      const tagIds = [];
      item.tagIds.forEach((id) => {
        const tag = tagById.get(id);
        if (tag && tag.module === item.module && !tagIds.includes(tag.id)) tagIds.push(tag.id);
      });
      return { ...item, groupId, tagIds, translations: kept };
    });

  return { languages: dedupedLanguages, groups, tags, entries };
}

// 读取数据文件：文件缺失或内容损坏时回落到初始数据并立刻补写
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (err) {
    const data = seedData();
    save(data);
    return data;
  }
}

// 先写临时文件再改名，写入中途被打断也不会把正式数据文件写坏
function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = `${JSON.stringify(normalize(data), null, 2)}\n`;
  fs.writeFileSync(TEMP_FILE, text, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

module.exports = {
  load,
  save,
  seedData,
  normalize,
  normalizeLanguage,
  normalizeEntry,
  normalizeGroup,
  normalizeTag,
  normalizeGroups,
  normalizeTags,
  MAX_TRANSLATION_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_OPERATOR_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  MAX_TAG_NAME_LENGTH,
  MAX_ENTRY_TAGS,
  UNNAMED,
  DATA_FILE,
};
