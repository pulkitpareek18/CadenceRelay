import { Router } from 'express';
import multer from 'multer';
import {
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  scheduleCampaign, sendCampaign, pauseCampaign, resumeCampaign, getCampaignRecipients,
  addAttachments, removeAttachment,
} from '../controllers/campaigns.controller';
import { validateBody } from '../middleware/validateRequest';
import { z } from 'zod';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file
  fileFilter: (_req, file, cb) => {
    // Block executable files
    const blocked = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi'];
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (ext && blocked.includes(`.${ext}`)) {
      cb(new Error(`File type .${ext} is not allowed`));
      return;
    }
    cb(null, true);
  },
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  templateId: z.string().uuid().optional(),
  listId: z.string().uuid().optional(),
  provider: z.enum(['gmail', 'ses']).optional(),
  throttlePerSecond: z.number().min(1).max(100).optional(),
  throttlePerHour: z.number().min(1).max(100000).optional(),
});

const scheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

router.get('/', listCampaigns);
router.get('/:id', getCampaign);
// Create campaign with optional attachments (multipart form)
router.post('/', upload.array('attachments', 10), (req, _res, next) => {
  // Parse JSON fields from multipart form
  if (typeof req.body.throttlePerSecond === 'string') req.body.throttlePerSecond = parseInt(req.body.throttlePerSecond) || 5;
  if (typeof req.body.throttlePerHour === 'string') req.body.throttlePerHour = parseInt(req.body.throttlePerHour) || 5000;
  next();
}, createCampaign);
router.put('/:id', validateBody(updateSchema), updateCampaign);
router.delete('/:id', deleteCampaign);
router.post('/:id/schedule', validateBody(scheduleSchema), scheduleCampaign);
router.post('/:id/send', sendCampaign);
router.post('/:id/pause', pauseCampaign);
router.post('/:id/resume', resumeCampaign);
router.get('/:id/recipients', getCampaignRecipients);
// Attachment management
router.post('/:id/attachments', upload.array('attachments', 10), addAttachments);
router.delete('/:id/attachments/:index', removeAttachment);

export default router;
