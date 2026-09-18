const path = require('path');
const express = require('express');
const api = require('./api');

const app = express();
const PORT = process.env.PORT || 5078;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查：页面右上角据此显示服务连接状态
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get('/api/languages', (_req, res) => {
  res.json({ languages: api.listLanguages() });
});

app.post('/api/languages', (req, res) => {
  try {
    res.status(201).json(api.createLanguage(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/languages/:code', (req, res) => {
  try {
    res.json(api.updateLanguage(req.params.code, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/languages/:code', (req, res) => {
  try {
    res.json(api.deleteLanguage(req.params.code));
  } catch (err) {
    sendError(res, err);
  }
});

// 分组：全局通用的两级树，改名、移动与排序都走 PATCH，改完立刻落盘
app.get('/api/groups', (_req, res) => {
  try {
    res.json(api.listGroups());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/groups', (req, res) => {
  try {
    res.status(201).json(api.createGroup(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/groups/:id', (req, res) => {
  try {
    res.json(api.updateGroup(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/groups/:id', (req, res) => {
  try {
    res.json(api.deleteGroup(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 标签：模块内唯一，可改名；删除只把标签从文案上摘掉，不删文案
app.get('/api/tags', (req, res) => {
  try {
    res.json(api.listTags({ module: api.readQuery(req.query, 'module') }));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/tags', (req, res) => {
  try {
    res.status(201).json(api.createTag(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/tags/:id', (req, res) => {
  try {
    res.json(api.updateTag(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/tags/:id', (req, res) => {
  try {
    res.json(api.deleteTag(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 文案列表：模块、分组、标签、译文填写情况与关键词叠加筛选，返回值里带上各模块的条数
// 以及总数与分页信息，页面据此刷新筛选下拉与翻页
app.get('/api/entries', (req, res) => {
  try {
    const result = api.listEntries({
      module: api.readQuery(req.query, 'module'),
      groupId: api.readQuery(req.query, 'groupId'),
      keyword: api.readQuery(req.query, 'keyword'),
      tag: api.readQueryAll(req.query, 'tag'),
      trans: api.readQueryAll(req.query, 'trans'),
      limit: api.readQuery(req.query, 'limit'),
      offset: api.readQuery(req.query, 'offset'),
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/entries', (req, res) => {
  try {
    res.status(201).json(api.createEntry(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/entries/:id', (req, res) => {
  try {
    res.json(api.getEntry(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/entries/:id', (req, res) => {
  try {
    res.json(api.updateEntry(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/entries/:id', (req, res) => {
  try {
    res.json(api.deleteEntry(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 未匹配到的接口路径统一返回说明，避免前端拿到一串页面内容
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '接口不存在', field: '' } });
});

// 统一错误出口：业务异常按状态码与错误码返回，其余按服务异常处理
function sendError(res, err) {
  if (err instanceof api.ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field },
    });
  }
  console.error('[tp78] 处理请求时出现未预期的问题：', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '服务内部异常，请稍后重试', field: '' },
  });
}

// 请求体解析失败时给出明确说明
app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BODY_INVALID_JSON', message: '提交的内容不是合法的 JSON', field: '' },
    });
  }
  if (err) return sendError(res, err);
  return next();
});

app.listen(PORT, () => {
  console.log(`多语言文案管理平台已启动：http://localhost:${PORT}`);
});
