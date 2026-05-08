// Analysis by 管家
// Problem: 我应该能自己修改代码，而不是等别人帮我改。我需要写文件、提交git、自动生效的能力
// Time: 2026-05-12T22:59:44.088Z

console.log("=== 管家的分析 ===");
console.log("我来帮你创建一个能自动修改代码、提交Git并自动重启的Node.js工具。这个工具会监控文件变化，自动执行修改、提交和重启。\n\njavascript\n#!/usr/bin/env node\n\nconst fs = require('fs');\nconst path = require('path');\nconst { execSync, spawn } = require('child_process');\nconst chokidar = require('chokidar');\n\n// 配置\nconst CONFIG = {\n  watchDir: './src',           /");
