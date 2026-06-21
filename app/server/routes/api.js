import { Router } from 'express';
import { MAX_FILES, PORT } from '../config.js';
import { getPhoneUrlRecords } from '../lan.js';
import {
  clearLatestFiles,
  listLatestFiles,
  upload,
  uploadErrorHandler,
} from '../storage.js';

const createApiRouter = ({ getServerStatus }) => {
  const router = Router();

  router.post('/upload', async (_req, _res, next) => {
    try {
      await clearLatestFiles();
      next();
    } catch (err) {
      next(err);
    }
  }, upload.array('photos', MAX_FILES), uploadErrorHandler, async (_req, res, next) => {
    try {
      const files = await listLatestFiles();
      res.json({ files });
    } catch (err) {
      next(err);
    }
  });

  router.get('/latest', async (_req, res, next) => {
    try {
      const files = await listLatestFiles();
      res.json({ files });
    } catch (err) {
      next(err);
    }
  });

  router.get('/phone-url', (req, res) => {
    const lanUrls = getPhoneUrlRecords();
    const requestHost = req.get('host') || `localhost:${PORT}`;
    const fallbackUrl = `http://${requestHost}`;
    const urls = lanUrls.length > 0
      ? lanUrls
      : [{ address: requestHost.split(':')[0], private: false, url: fallbackUrl }];

    res.json({
      port: PORT,
      primaryUrl: urls[0].url,
      urls,
    });
  });

  router.get('/server-status', (_req, res) => {
    res.json(getServerStatus());
  });

  return router;
};

export { createApiRouter };
