import http from "node:http";
import { config } from "./config.js";
import { app } from "./app.js";
import { attachTerminal } from "./terminal.js";
import { ensureAdmin } from "./bootstrap.js";
import { ensureFirewall, ensureRuntime } from "./lxd.js";
import { onDelete, recoverInterrupted } from "./instances.js";
import { removeInstanceDomains } from "./domains.js";
import { startCollector } from "./metrics.js";

ensureAdmin({ announce: true });
onDelete(removeInstanceDomains);

try {
  await ensureRuntime();
  await ensureFirewall();
} catch (error) {
  console.error(`LXD is not ready: ${error.message}. Containers will be unavailable until it is.`);
}
recoverInterrupted();
startCollector();

const server = http.createServer(app);
attachTerminal(server);
server.listen(config.port, config.host, () => {
  console.log(`Boukarou listening on http://${config.host}:${config.port} (project ${config.project})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
