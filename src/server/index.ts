import { loadConfig } from '../config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const address = app.server.address();
const actual = typeof address === 'object' && address !== null ? `${address.address}:${address.port}` : String(address);
app.log.info(
  `promptmanager listening on ${actual} (HOST=${config.host} PORT=${config.port}, DATA_DIR=${config.dataDir})`,
);

// P2-8：漏 await 的 promise 与未捕获异常 —— Node 默认也是让进程崩，这里多做的只有两件：
//   ① 把原因写进日志（默认崩法在某些场景只有一行堆栈、上下文丢了）；② 先优雅关库再退。
// 不"吞掉"异常继续跑 —— 状态可能已不一致，带病运行比退出更危险。
process.on('unhandledRejection', (reason: unknown) => {
  app.log.error({ err: reason }, 'unhandledRejection —— 进程即将退出');
  void app.close().then(
    () => process.exit(1),
    () => process.exit(1),
  );
});
process.on('uncaughtException', (error: Error) => {
  app.log.error({ err: error }, 'uncaughtException —— 进程即将退出');
  void app.close().then(
    () => process.exit(1),
    () => process.exit(1),
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
