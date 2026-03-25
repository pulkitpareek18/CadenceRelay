import { Router } from 'express';
import {
  listVariables,
  createVariable,
  updateVariable,
  deleteVariable,
  reorderVariables,
} from '../controllers/customVariables.controller';
import { validateBody } from '../middleware/validateRequest';
import { z } from 'zod';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  key: z.string().max(100).optional(),
  type: z.enum(['text', 'number', 'date', 'select']).optional().default('text'),
  options: z.array(z.string()).optional().default([]),
  required: z.boolean().optional().default(false),
  default_value: z.string().max(255).nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  key: z.string().max(100).optional(),
  type: z.enum(['text', 'number', 'date', 'select']).optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  default_value: z.string().max(255).nullable().optional(),
});

const reorderSchema = z.object({
  order: z.array(
    z.object({
      id: z.string().uuid(),
      sort_order: z.number().int().min(0),
    })
  ),
});

router.get('/', listVariables);
router.post('/', validateBody(createSchema), createVariable);
router.put('/reorder', validateBody(reorderSchema), reorderVariables);
router.put('/:id', validateBody(updateSchema), updateVariable);
router.delete('/:id', deleteVariable);

export default router;
