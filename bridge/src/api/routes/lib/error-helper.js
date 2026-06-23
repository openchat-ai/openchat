import logger from '../../../core/logger.js';

const GENERIC_MSG = 'Internal server error';

export function apiError(res, e, status = 500) {
  logger.error(`[API] ${status} ${e?.stack || e}`);
  if (!res.headersSent) {
    res.status(status).json({ success: false, error: GENERIC_MSG });
  }
}
