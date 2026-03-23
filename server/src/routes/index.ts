import { Router } from 'express';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// TODO: Mount route modules in upcoming sprints
// router.use('/auth', authRoutes);
// router.use('/contacts', authenticate, contactRoutes);
// router.use('/lists', authenticate, listRoutes);
// router.use('/campaigns', authenticate, campaignRoutes);
// router.use('/templates', authenticate, templateRoutes);
// router.use('/analytics', authenticate, analyticsRoutes);
// router.use('/settings', authenticate, settingsRoutes);
// router.use('/t', trackingRoutes);       // public
// router.use('/webhooks', webhookRoutes); // public

export default router;
