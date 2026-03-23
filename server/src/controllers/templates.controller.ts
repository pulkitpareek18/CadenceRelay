import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { detectVariables, renderTemplate } from '../utils/templateRenderer';

export async function listTemplates(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT id, name, subject, html_body, variables, version, is_active, created_at, updated_at FROM templates WHERE is_active = true ORDER BY updated_at DESC'
    );
    res.json({ templates: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function getTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new AppError('Template not found', 404);
    res.json({ template: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function createTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, subject, htmlBody, textBody } = req.body;
    const variables = detectVariables(htmlBody);

    const result = await pool.query(
      'INSERT INTO templates (name, subject, html_body, text_body, variables) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, subject, htmlBody, textBody || null, JSON.stringify(variables)]
    );

    const template = result.rows[0];

    // Create first version entry
    await pool.query(
      'INSERT INTO template_versions (template_id, version, subject, html_body, text_body, variables) VALUES ($1, 1, $2, $3, $4, $5)',
      [template.id, subject, htmlBody, textBody || null, JSON.stringify(variables)]
    );

    res.status(201).json({ template });
  } catch (err) {
    next(err);
  }
}

export async function updateTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { name, subject, htmlBody, textBody } = req.body;

    const existing = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new AppError('Template not found', 404);

    const newVersion = existing.rows[0].version + 1;

    // FIX: Always detect variables from the ACTUAL body being saved, not conditionally.
    // Determine the effective html_body that will be stored after COALESCE.
    const effectiveHtmlBody = htmlBody || existing.rows[0].html_body;
    const variables = detectVariables(effectiveHtmlBody);

    const result = await pool.query(
      `UPDATE templates SET
        name = COALESCE($1, name),
        subject = COALESCE($2, subject),
        html_body = COALESCE($3, html_body),
        text_body = COALESCE($4, text_body),
        variables = $5,
        version = $6,
        updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name, subject, htmlBody, textBody, JSON.stringify(variables), newVersion, id]
    );

    // Save version
    const t = result.rows[0];
    await pool.query(
      'INSERT INTO template_versions (template_id, version, subject, html_body, text_body, variables) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, newVersion, t.subject, t.html_body, t.text_body, JSON.stringify(variables)]
    );

    res.json({ template: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function deleteTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE templates SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) throw new AppError('Template not found', 404);
    res.json({ message: 'Template deleted' });
  } catch (err) {
    next(err);
  }
}

export async function getTemplateVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, version, subject, created_at FROM template_versions WHERE template_id = $1 ORDER BY version DESC',
      [id]
    );
    res.json({ versions: result.rows });
  } catch (err) {
    next(err);
  }
}

export async function getTemplateVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, version } = req.params;

    // FIX: Validate that version is a valid number
    const versionNum = parseInt(version);
    if (isNaN(versionNum) || versionNum < 1) {
      throw new AppError('Invalid version number', 400);
    }

    const result = await pool.query(
      'SELECT * FROM template_versions WHERE template_id = $1 AND version = $2',
      [id, versionNum]
    );
    if (result.rows.length === 0) throw new AppError('Version not found', 404);
    res.json({ version: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function previewTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { data } = req.body;

    const result = await pool.query('SELECT html_body FROM templates WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new AppError('Template not found', 404);

    const sampleData = data || { school_name: 'Example School', email: 'test@example.com', name: 'John Doe' };
    const rendered = renderTemplate(result.rows[0].html_body, sampleData);

    res.json({ html: rendered });
  } catch (err) {
    next(err);
  }
}
