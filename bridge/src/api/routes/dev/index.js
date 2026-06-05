/**
 * Dev UI — web-based REPL 替代命令行 REPL
 * 提供 /dev 页面（page.html）和静态资源（page.css, page.js）
 */
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = __dirname;

router.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'page.html'));
});

router.get('/page.css', (req, res) => {
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.sendFile(path.join(ROOT, 'page.css'));
});

router.get('/page.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(path.join(ROOT, 'page.js'));
});

export default router;
