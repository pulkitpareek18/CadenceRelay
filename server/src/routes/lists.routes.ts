import { Router } from 'express';
import {
  listLists,
  getList,
  createList,
  createSmartList,
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

const createSmartSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  filterCriteria: z.object({
    state: z.array(z.string()).optional(),
    district: z.array(z.string()).optional(),
    block: z.array(z.string()).optional(),
    category: z.array(z.string()).optional(),
    management: z.array(z.string()).optional(),
    classes_min: z.number().optional(),
    classes_max: z.number().optional(),
  }),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  filterCriteria: z.object({
    state: z.array(z.string()).optional(),
    district: z.array(z.string()).optional(),
    block: z.array(z.string()).optional(),
    category: z.array(z.string()).optional(),
    management: z.array(z.string()).optional(),
    classes_min: z.number().optional(),
    classes_max: z.number().optional(),
  }).optional(),
});

const contactIdsSchema = z.object({
  contactIds: z.array(z.string().uuid()).min(1),
});

router.get('/', listLists);
router.get('/:id', getList);
router.post('/', validateBody(createSchema), createList);
router.post('/smart', validateBody(createSmartSchema), createSmartList);
router.put('/:id', validateBody(updateSchema), updateList);
router.delete('/:id', deleteList);
router.post('/:id/contacts', validateBody(contactIdsSchema), addContactsToList);
router.delete('/:id/contacts', validateBody(contactIdsSchema), removeContactsFromList);

export default router;
