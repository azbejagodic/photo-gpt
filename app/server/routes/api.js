import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR, MAX_FILES, PORT } from '../config.js';
import { getPhoneUrlRecords } from '../lan.js';
import {
  clearLatestFiles,
  listLatestFiles,
  upload,
  uploadErrorHandler,
} from '../storage.js';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

const getCrc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZipBuffer = async (files) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const data = await fs.readFile(path.join(DATA_DIR, file.name));
    const name = Buffer.from(file.name, 'utf8');
    const crc = getCrc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectorySize, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endRecord]);
};

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

  router.get('/latest/download', async (_req, res, next) => {
    try {
      const files = await listLatestFiles();
      if (files.length === 0) {
        res.status(404).json({ error: 'No pictures available.' });
        return;
      }

      const zipBuffer = await createZipBuffer(files);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="photo-gpt-latest.zip"');
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.send(zipBuffer);
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
