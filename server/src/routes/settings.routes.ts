import { Router } from 'express';
import {
  getSettings,
  updateProvider,
  updateGmailConfig,
  updateSesConfig,
  updateThrottleDefaults,
  updateReplyTo,
  testEmail,
} from '../controllers/settings.controller';
import { validateBody } from '../middleware/validateRequest';
import { z } from 'zod';

const router = Router();

const providerSchema = z.object({
  provider: z.enum(['gmail', 'ses']),
});

const gmailSchema = z.object({
  host: z.string().optional().default('smtp.gmail.com'),
  port: z.number().optional().default(587),
  user: z.string().min(1),
  pass: z.string().default(''),
});

const sesSchema = z.object({
  region: z.string().min(1),
  accessKeyId: z.string().default(''),
  secretAccessKey: z.string().default(''),
  fromEmail: z.string().email(),
  fromName: z.string().optional().default(''),
});

const throttleSchema = z.object({
  perSecond: z.number().min(1).max(100),
  perHour: z.number().min(1).max(100000),
});

const replyToSchema = z.object({
  replyTo: z.union([z.string().email(), z.literal('')]),
});

const testEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().optional(),
  html: z.string().optional(),
});

router.get('/', getSettings);
router.put('/provider', validateBody(providerSchema), updateProvider);
router.put('/gmail', validateBody(gmailSchema), updateGmailConfig);
router.put('/ses', validateBody(sesSchema), updateSesConfig);
router.put('/throttle', validateBody(throttleSchema), updateThrottleDefaults);
router.put('/reply-to', validateBody(replyToSchema), updateReplyTo);
router.post('/test-email', validateBody(testEmailSchema), testEmail);

export default router;
