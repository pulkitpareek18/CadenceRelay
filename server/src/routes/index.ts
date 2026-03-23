import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import authRoutes from './auth.routes';
import settingsRoutes from './settings.routes';
import contactsRoutes from './contacts.routes';
import listsRoutes from './lists.routes';
import templatesRoutes from './templates.routes';
import campaignsRoutes from './campaigns.routes';

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

// Protected routes
router.use('/settings', authenticate, settingsRoutes);
router.use('/contacts', authenticate, contactsRoutes);
router.use('/lists', authenticate, listsRoutes);
router.use('/templates', authenticate, templatesRoutes);
router.use('/campaigns', authenticate, campaignsRoutes);

// TODO: Mount remaining route modules in upcoming sprints
// router.use('/campaigns', authenticate, campaignRoutes);
// router.use('/templates', authenticate, templateRoutes);
// router.use('/analytics', authenticate, analyticsRoutes);
// router.use('/t', trackingRoutes);       // public
// router.use('/webhooks', webhookRoutes); // public

export default router;
