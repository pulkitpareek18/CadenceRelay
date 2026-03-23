import { Router } from 'express';
import { getDashboard, getCampaignAnalytics, exportAnalytics } from '../controllers/analytics.controller';

const router = Router();

router.get('/dashboard', getDashboard);
router.get('/campaigns/:id', getCampaignAnalytics);
router.get('/export', exportAnalytics);

export default router;
