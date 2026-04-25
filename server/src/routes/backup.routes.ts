import { Router } from 'express';
import multer from 'multer';
import { exportBackup, importBackup } from '../controllers/backup.controller';

const router = Router();

// Use memory storage with a generous limit for backup files (up to 500MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.get('/export', exportBackup);
router.post('/import', upload.single('backup'), importBackup);

export default router;
