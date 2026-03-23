import { Router } from 'express';
import {
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  scheduleCampaign, sendCampaign, pauseCampaign, resumeCampaign, getCampaignRecipients,
} from '../controllers/campaigns.controller';
import { validateBody } from '../middleware/validateRequest';
import { z } from 'zod';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(255),
  templateId: z.string().uuid(),
  listId: z.string().uuid(),
  provider: z.enum(['gmail', 'ses']).optional(),
  throttlePerSecond: z.number().min(1).max(100).optional(),
  throttlePerHour: z.number().min(1).max(100000).optional(),
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
router.post('/', validateBody(createSchema), createCampaign);
router.put('/:id', validateBody(updateSchema), updateCampaign);
router.delete('/:id', deleteCampaign);
router.post('/:id/schedule', validateBody(scheduleSchema), scheduleCampaign);
router.post('/:id/send', sendCampaign);
router.post('/:id/pause', pauseCampaign);
router.post('/:id/resume', resumeCampaign);
router.get('/:id/recipients', getCampaignRecipients);

export default router;
