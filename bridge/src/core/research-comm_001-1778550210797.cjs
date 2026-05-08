// Research: 实例间通讯方式研究：除了HTTP ping，还有哪些方式可以检测姐妹状态？
// Generated: 2026-05-12T01:43:30.797Z

const http = require("http");
const net = require("net");

console.log("=== Network Analysis ===");

const ports = [3000, 3100, 3200, 3300, 3400, 3500, 3600, 3800, 3801];
const results = {};

for (const port of ports) {
  try {
    const server = net.createServer();
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE") results[port] = "in_use";
      else results[port] = "error:" + e.code;
      server.close();
    });
    server.once("listening", () => {
      results[port] = "free";
      server.close();
    });
    server.listen(port, "localhost");
  } catch (e) {
    results[port] = "check_failed";
  }
}

setTimeout(() => {
  console.log("Port scan results:");
  Object.entries(results).forEach(([p, s]) => console.log("  :" + p + " -> " + s));
  const inUse = Object.values(results).filter(s => s === "in_use").length;
  console.log("Ports in use:", inUse, "of", ports.length);
  console.log("Recommendation: Use heartbeat interval of 5s, timeout of 3s for cluster comms");
}, 2000);
