import { Router } from 'express';
import multer from 'multer';
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  exportContacts,
} from '../controllers/contacts.controller';
import { validateBody } from '../middleware/validateRequest';
import { z } from 'zod';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  listIds: z.array(z.string().uuid()).optional(),
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'bounced', 'complained', 'unsubscribed']).optional(),
});

router.get('/', listContacts);
router.get('/export', exportContacts);
router.get('/:id', getContact);
router.post('/', validateBody(createSchema), createContact);
router.put('/:id', validateBody(updateSchema), updateContact);
router.delete('/:id', deleteContact);
router.post('/import', upload.single('file'), importContacts);

export default router;
