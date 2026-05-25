import { Router } from 'express';
import { qiniuSignaling } from '../../core/qiniu-signaling.js';

const router = Router();

router.post('/upload', async (req, res, next) => {
  try {
    const { path, content } = req.body;
    if (!path || content === undefined || content === null) {
      return res.status(400).json({ error: 'path and content required' });
    }
    const bucket = process.env.QINIU_BUCKET || 'dapin-xp';
    const payload = typeof content === 'string' ? content : JSON.stringify(content);
    await qiniuSignaling.writeTo(bucket, path, payload);
    res.json({ ok: true, path });
  } catch (e) {
    next(e);
  }
});

export default router;
