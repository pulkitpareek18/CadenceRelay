import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import authRoutes from './auth.routes';
import settingsRoutes from './settings.routes';
import contactsRoutes from './contacts.routes';
import listsRoutes from './lists.routes';
import templatesRoutes from './templates.routes';
import campaignsRoutes from './campaigns.routes';
import analyticsRoutes from './analytics.routes';
import trackingRoutes from './tracking.routes';
import webhookRoutes from './webhooks.routes';

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

// Public routes
router.use('/t', trackingRoutes);
router.use('/webhooks', webhookRoutes);

router.use('/analytics', authenticate, analyticsRoutes);

export default router;
