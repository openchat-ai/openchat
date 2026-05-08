// Research: 热加载协作策略：新代码先让一个实例测试，成功后才让其他实例热加载更新
// Generated: 2026-05-09T16:06:21.872Z

const { execSync } = require("child_process");
const fs = require("fs");

console.log("=== Git Analysis ===");
try {
  const log = execSync("git log --oneline -20", { encoding: "utf8" });
  const lines = log.trim().split("
");
  console.log("Recent commits:", lines.length);
  const authors = new Set(lines.map(l => l.split(" ")[1]));
  console.log("Unique authors:", authors.size);
  const status = execSync("git status --short", { encoding: "utf8" });
  const dirty = status.trim().split("
").filter(l => l.trim());
  console.log("Dirty files:", dirty.length);
  console.log("Recommendations: " + (dirty.length > 5 ? "Too many uncommitted changes" : "Working tree is clean"));
} catch (e) {
  console.log("Git analysis error:", e.message);
}
