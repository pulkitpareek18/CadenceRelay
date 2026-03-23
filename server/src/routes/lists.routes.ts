import { Router } from 'express';
import {
  listLists,
  getList,
  createList,
  updateList,
  deleteList,
  addContactsToList,
  removeContactsFromList,
} from '../controllers/lists.controller';
import { validateBody } from '../middleware/validateRequest';
import { z } from 'zod';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
});

const contactIdsSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1),
});

router.get('/', listLists);
router.get('/:id', getList);
router.post('/', validateBody(createSchema), createList);
router.put('/:id', validateBody(updateSchema), updateList);
router.delete('/:id', deleteList);
router.post('/:id/contacts', validateBody(contactIdsSchema), addContactsToList);
router.delete('/:id/contacts', validateBody(contactIdsSchema), removeContactsFromList);

export default router;
