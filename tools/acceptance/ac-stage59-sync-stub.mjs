/**
 * 阶段 59 / FR-125 / AC-121：GitHub Contents API 的**本地桩**（只用于自动化验证，不是产品代码）。
 *
 * 用法：`node tools/ac-stage59-sync-stub.mjs`
 * stdout 第一行打印 `STUB_URL=http://127.0.0.1:<port>`；应用服务用 `SYNC_GITHUB_API_BASE=<该 URL>`
 * 指向它，于是「测试连接 / 立即上传 / 从云端恢复」全程**不碰真实 GitHub**
 * （⛔ 本阶段绝不使用真实 token：token 是仓库级凭据，进代码/日志就等于泄漏）。
 *
 * 路由（字段照 GitHub Contents API 裁剪，够服务端 `src/services/sync-github.ts` 判读即可）：
 *   GET  /repos/:owner/:repo               → {default_branch, permissions:{push}}
 *   GET  /repos/:owner/:repo/contents/*    → 200 {content: base64, sha, size} / 404
 *   PUT  /repos/:owner/:repo/contents/*    → 200 {content:{sha}, commit:{sha}}（记录 commit）
 *   GET  /__stats                          → {requests,gets,puts,commits,paths}  ← 零出网 / dry_run 证据
 *   POST /__mode                           → 运行时切形态（见下），body 是 JSON
 *
 * 形态开关（环境变量给初值，运行时可被 `POST /__mode` 改）：
 *   STUB_TOKEN=<t>        Authorization 不是 `Bearer <t>` ⇒ 401（演 token 无效）
 *   STUB_NO_PUSH=1        permissions.push=false ⇒ 服务端映射成"无写权限"
 *   STUB_NETWORK_FAIL=1   直接断开连接 ⇒ 服务端映射成中文"连不上 GitHub"
 *   STUB_CONFLICT_ONCE=1  下一次 PUT 回 409 并把远端 sha 换新（模拟"取完 sha 后被他人改动"）
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const mode = {
  token: process.env.STUB_TOKEN ?? null,
  push: process.env.STUB_NO_PUSH !== '1',
  networkFail: process.env.STUB_NETWORK_FAIL === '1',
  conflictOnce: process.env.STUB_CONFLICT_ONCE === '1',
};

/** 远端文件表：path → { sha, body(JSON 文本) }。空表 = 空仓库（GET 一律 404）。 */
const files = new Map();
const stats = { requests: 0, gets: 0, puts: 0, commits: [], paths: [] };
let seq = 0;
const shaOf = (text) => createHash('sha256').update(`${String(seq)}:${text}`).digest('hex').slice(0, 40);

const send = (res, code, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    // 控制面：桩自己的形态与计数，不模拟 GitHub，也不需要 token，
    // 而且**不计入 stats.requests**（否则"读一次计数"本身就会让计数 +1，
    // 零出网 / dry_run 的判据就被自己污染了）。
    if (url.pathname === '/__stats') {
      return send(res, 200, stats);
    }
    if (url.pathname === '/__mode') {
      const raw = await readBody(req);
      const patch = raw === '' ? {} : JSON.parse(raw);
      if ('token' in patch) mode.token = patch.token;
      if ('push' in patch) mode.push = patch.push === true;
      if ('networkFail' in patch) mode.networkFail = patch.networkFail === true;
      if ('conflictOnce' in patch) mode.conflictOnce = patch.conflictOnce === true;
      return send(res, 200, { ...mode, files: [...files.keys()] });
    }
    stats.requests += 1;

    if (mode.networkFail) {
      // 模拟网络异常：直接断连（服务端 fetch 抛错 ⇒ 中文"连不上 GitHub"）。
      req.socket.destroy();
      return undefined;
    }
    if (mode.token !== null && req.headers.authorization !== `Bearer ${mode.token}`) {
      return send(res, 401, { message: 'Bad credentials' });
    }

    const m = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(url.pathname);
    if (m === null) {
      // GET /repos/:owner/:repo
      const repo = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (repo !== null && req.method === 'GET') {
        stats.gets += 1;
        return send(res, 200, { default_branch: 'main', permissions: { push: mode.push } });
      }
      return send(res, 404, { message: 'Not Found' });
    }

    const filePath = decodeURIComponent(m[3]);
    const key = `${m[1]}/${m[2]}/${filePath}`;
    if (req.method === 'GET') {
      stats.gets += 1;
      const file = files.get(filePath);
      if (file === undefined) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, { content: Buffer.from(file.body, 'utf8').toString('base64'), sha: file.sha, size: Buffer.byteLength(file.body) });
    }
    if (req.method === 'PUT') {
      const raw = await readBody(req);
      if (!mode.push) return send(res, 403, { message: 'Resource not accessible by personal access token' });
      if (mode.conflictOnce) {
        // 冲突形态：把远端 sha 换新（等价于"你取完 sha 之后别人又改过"），只演一次。
        mode.conflictOnce = false;
        const existing = files.get(filePath);
        if (existing !== undefined) existing.sha = shaOf(`${filePath}:conflict`);
        return send(res, 409, { message: 'Conflict: sha does not match' });
      }
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { message: 'bad request body' });
      }
      const text = Buffer.from(String(body.content ?? ''), 'base64').toString('utf8');
      seq += 1;
      const sha = shaOf(text);
      files.set(filePath, { sha, body: text });
      stats.puts += 1;
      stats.commits.push({ path: filePath, sha, bytes: Buffer.byteLength(text) });
      stats.paths = [...files.keys()];
      return send(res, 200, { content: { sha, path: filePath }, commit: { sha: shaOf(`commit:${key}:${String(seq)}`) } });
    }
    return send(res, 405, { message: 'Method Not Allowed' });
  })().catch((error) => {
    try {
      send(res, 500, { message: String(error) });
    } catch {
      /* 连接已断，忽略 */
    }
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  process.stdout.write(`STUB_URL=http://127.0.0.1:${String(port)}\n`);
});
