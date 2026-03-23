import { Router } from 'express';
import multer from 'multer';
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  bulkDeleteContacts,
  importContacts,
  importContactsCSV,
  previewCSV,
  exportContacts,
  getContactFilters,
} from '../controllers/contacts.controller';
import { validateBody } from '../middleware/validateRequest';
import { z } from 'zod';

const router = Router();
// Increase file size limit to 100MB for large school CSVs (280k+ rows)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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
router.get('/filters', getContactFilters);
router.get('/:id', getContact);
router.post('/', validateBody(createSchema), createContact);
router.put('/:id', validateBody(updateSchema), updateContact);
router.delete('/bulk', bulkDeleteContacts);
router.delete('/:id', deleteContact);
router.post('/import', upload.single('file'), importContacts);
router.post('/import-csv', upload.single('file'), importContactsCSV);
router.post('/preview-csv', upload.single('file'), previewCSV);

export default router;
