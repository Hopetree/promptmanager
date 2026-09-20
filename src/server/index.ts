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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
