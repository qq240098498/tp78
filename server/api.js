// 对外的动作集合：页面只经过这一层，语言、文案、分组与标签各自管好自己的校验与落盘
const { ApiError, pickText } = require('./errors');
const languages = require('./languages');
const entries = require('./entries');
const groups = require('./groups');
const tags = require('./tags');

// 查询参数在页面与接口之间来回传的都是文本，这里统一去掉首尾空白并兜住空值
function readQuery(query, name) {
  return pickText(query && query[name]);
}

// 允许在查询串里重复出现的参数（如 tag、trans），全部原样收集
function readQueryAll(query, name) {
  if (!query) return [];
  const value = query[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

module.exports = {
  ApiError,
  readQuery,
  readQueryAll,
  ...languages,
  ...entries,
  ...groups,
  ...tags,
};
