import express from 'express';
import { getBatchFilePath } from '../storage.js';

const createFilesRouter = () => {
  const router = express.Router();

  router.get('/:name', async (req, res) => {
    try {
      const filePath = await getBatchFilePath(req.params.name);
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(filePath);
    } catch (err) {
      res.status(404).json({ error: err.message || 'File not found.' });
    }
  });

  return router;
};

export { createFilesRouter };
