import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import authRoutes from './auth.routes';
import settingsRoutes from './settings.routes';
import contactsRoutes from './contacts.routes';
import listsRoutes from './lists.routes';
import templatesRoutes from './templates.routes';
import campaignsRoutes from './campaigns.routes';
import campaignLabelsRoutes from './campaignLabels.routes';
import { downloadAttachment } from '../controllers/campaigns.controller';
import analyticsRoutes from './analytics.routes';
import adminRoutes from './admin.routes';
import customVariablesRoutes from './customVariables.routes';
import projectsRoutes from './projects.routes';
import suppressionRoutes from './suppression.routes';
import automationsRoutes from './automations.routes';
import emailAccountRoutes from './emailAccounts.routes';
import backupRoutes from './backup.routes';
import trackingRoutes from './tracking.routes';
import webhookRoutes from './webhooks.routes';
import sseRoutes from './sse.routes';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Auth (public)
router.use('/auth', authRoutes);

// Public routes (MUST be before authenticated routes to avoid auth middleware intercepting)
router.use('/t', trackingRoutes);
router.use('/webhooks', webhookRoutes);
// Public attachment download/preview — registered as a sub-router to ensure it takes full priority
const publicAttachmentRouter = Router();
publicAttachmentRouter.get('/:id/attachments/:index/preview', downloadAttachment);
publicAttachmentRouter.get('/:id/attachments/:index', downloadAttachment);
router.use('/campaigns', publicAttachmentRouter);

// Protected routes
router.use('/settings', authenticate, settingsRoutes);
router.use('/contacts', authenticate, contactsRoutes);
router.use('/lists', authenticate, listsRoutes);
router.use('/templates', authenticate, templatesRoutes);
router.use('/campaigns', authenticate, campaignsRoutes);
router.use('/campaign-labels', authenticate, campaignLabelsRoutes);
router.use('/admin', authenticate, adminRoutes);
router.use('/custom-variables', authenticate, customVariablesRoutes);
router.use('/projects', authenticate, projectsRoutes);
router.use('/suppression', authenticate, suppressionRoutes);
router.use('/automations', authenticate, automationsRoutes);
router.use('/email-accounts', authenticate, emailAccountRoutes);
router.use('/backup', authenticate, backupRoutes);

router.use('/analytics', authenticate, analyticsRoutes);

// SSE routes (authenticated)
router.use('/sse', sseRoutes);

export default router;
