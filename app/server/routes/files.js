import express from 'express';
import { DATA_DIR } from '../config.js';

const createFilesRouter = () => express.static(DATA_DIR, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  },
});

export { createFilesRouter };
