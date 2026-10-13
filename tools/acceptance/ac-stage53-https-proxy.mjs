/**
 * 阶段 53 / FR-117：**测试用** HTTPS 反向代理（不是产品代码、不入库需求范围）。
 *
 * 为什么需要它：应用本身只提供 HTTP（`node dist/server/index.js`），而 R-9 的核心场景恰恰是
 * **用户经 HTTPS 访问**（生产上 `https://prompt.tendcode.com` 前面有反代）。要真实验证
 * 「访问地址」显示的是**浏览器实际访问的协议**，就必须让浏览器**真的**从 `https://` 加载页面。
 *
 * 做法：用一个**一次性自签证书**起一个最薄的 TLS 终结 + 转发，把请求原样转给后端 HTTP 实例。
 * 这与生产拓扑一致（TLS 在反代终结 ⇒ 后端仍是 HTTP），且 `window.location.origin` 会如实变成 `https://…`。
 * 浏览器侧用 `--ignore-certificate-errors` 接受自签证书（**仅本机自测**，不改变任何服务端校验）。
 *
 * 依赖：只用 Node 内置 `node:https` / `node:http`（STANDARDS §4.2 禁止手搓的是**产品**基础设施；
 *       这里是测试夹具里的几十行端口转发，且用的就是 Node 标准库）。
 *
 * 用法：node tools/ac-stage53-https-proxy.mjs <listenPort> <targetPort> <certFile> <keyFile>
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const [listenPort, targetPort, certFile, keyFile] = process.argv.slice(2);
const target = Number(targetPort);

const server = https.createServer(
  { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) },
  (req, res) => {
    // 最小转发：把原始请求打到后端，再把状态/头/体原样送回（不改任何内容）。
    const proxied = http.request(
      { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${target}` } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    proxied.on('error', () => {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('proxy error');
    });
    req.pipe(proxied);
  },
);

server.listen(Number(listenPort), '127.0.0.1', () => {
  console.log(`HTTPS_PROXY_READY https://127.0.0.1:${listenPort} -> http://127.0.0.1:${target}`);
});
