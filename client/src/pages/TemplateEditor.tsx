import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';
import { getTemplate, createTemplate, updateTemplate, getTemplateVersions } from '../api/templates.api';
import { sendTestEmail } from '../api/settings.api';

const DEFAULT_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f4f4f4; }
    .container { max-width: 600px; margin: 0 auto; background: white; }
    .header { background: #2563eb; color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; }
    .footer { padding: 20px 30px; text-align: center; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Your Organization</h1>
    </div>
    <div class="content">
      <p>Dear {{school_name}},</p>
      <p>We are pleased to invite you to our programme.</p>
      <p>Best regards,<br>Your Team</p>
    </div>
    <div class="footer">
      <p>You are receiving this because you are registered as {{email}}</p>
    </div>
  </div>
</body>
</html>`;

export default function TemplateEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState(DEFAULT_HTML);
  const [versions, setVersions] = useState<{ version: number; created_at: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [variables, setVariables] = useState<string[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const savedStateRef = useRef({ name: '', subject: '', htmlBody: DEFAULT_HTML });

  useEffect(() => {
    if (!isNew && id) {
      getTemplate(id).then((t) => {
        setName(t.name);
        setSubject(t.subject);
        setHtmlBody(t.html_body);
        setVariables(t.variables || []);
        savedStateRef.current = { name: t.name, subject: t.subject, htmlBody: t.html_body };
      }).catch(() => toast.error('Failed to load template'));
      getTemplateVersions(id).then(setVersions).catch(() => {});
    }
  }, [id, isNew]);

  // Track unsaved changes
  useEffect(() => {
    const saved = savedStateRef.current;
    const changed = name !== saved.name || subject !== saved.subject || htmlBody !== saved.htmlBody;
    setHasUnsavedChanges(changed);
  }, [name, subject, htmlBody]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (hasUnsavedChanges) {
        e.preventDefault();
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const updatePreview = useCallback(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(htmlBody);
        doc.close();
      }
    }
  }, [htmlBody]);

  useEffect(() => {
    // Detect variables
    const regex = /\{\{(\w+)\}\}/g;
    const vars = new Set<string>();
    let match;
    while ((match = regex.exec(htmlBody)) !== null) vars.add(match[1]);
    setVariables(Array.from(vars));

    // Update preview with a small delay for iframe readiness
    const timer = setTimeout(updatePreview, 100);
    return () => clearTimeout(timer);
  }, [htmlBody, updatePreview]);

  // Also update preview when iframe loads
  function handleIframeLoad() {
    updatePreview();
  }

  async function handleSave() {
    if (!name || !subject || !htmlBody) {
      toast.error('Name, subject, and HTML body are required');
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const t = await createTemplate({ name, subject, htmlBody });
        toast.success('Template created');
        savedStateRef.current = { name, subject, htmlBody };
        setHasUnsavedChanges(false);
        navigate(`/templates/${t.id}/edit`, { replace: true });
      } else {
        await updateTemplate(id!, { name, subject, htmlBody });
        toast.success('Template saved');
        savedStateRef.current = { name, subject, htmlBody };
        setHasUnsavedChanges(false);
        getTemplateVersions(id!).then(setVersions).catch(() => {});
      }
    } catch {
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTest() {
    if (!testEmail.trim()) {
      toast.error('Please enter a test email address');
      return;
    }
    setSendingTest(true);
    try {
      await sendTestEmail(testEmail);
      toast.success(`Test email sent to ${testEmail}`);
      setShowTestModal(false);
      setTestEmail('');
    } catch {
      toast.error('Failed to send test email. Check your email provider settings.');
    } finally {
      setSendingTest(false);
    }
  }

  function handleBack() {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Are you sure you want to leave?')) return;
    }
    navigate('/templates');
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700">&larr; Back</button>
        <input
          type="text"
          placeholder="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
        <input
          type="text"
          placeholder="Email subject line"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="flex-1 rounded border px-2 py-1 text-sm"
        />
        {versions.length > 0 && (
          <span className="text-xs text-gray-400">v{versions[0]?.version || 1}</span>
        )}
        {hasUnsavedChanges && (
          <span className="text-xs text-orange-500 font-medium">Unsaved</span>
        )}
        <button onClick={() => setShowTestModal(true)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
          Send Test
        </button>
        <button onClick={handleSave} disabled={saving} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Variables bar */}
      {variables.length > 0 && (
        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
          <span className="text-xs text-gray-500">Variables:</span>
          {variables.map((v) => (
            <span key={v} className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600 font-mono">{`{{${v}}}`}</span>
          ))}
        </div>
      )}

      {/* Editor + Preview split */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 border-r border-gray-200">
          <Editor
            height="100%"
            defaultLanguage="html"
            value={htmlBody}
            onChange={(val) => setHtmlBody(val || '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: 'on',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
            }}
          />
        </div>
        <div className="w-1/2 bg-gray-100 p-4">
          <div className="mb-2 text-xs font-medium text-gray-500">Preview</div>
          <iframe
            ref={iframeRef}
            className="h-full w-full rounded-lg border bg-white"
            title="Template Preview"
            sandbox="allow-same-origin"
            onLoad={handleIframeLoad}
          />
        </div>
      </div>

      {/* Send Test Email Modal */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">Send Test Email</h3>
            <p className="mt-1 text-sm text-gray-500">
              Send a test email using your current provider settings. The template will be sent as-is (variables will not be replaced).
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">Recipient Email</label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="test@example.com"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setShowTestModal(false); setTestEmail(''); }} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleSendTest} disabled={sendingTest || !testEmail.trim()} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50">
                {sendingTest ? 'Sending...' : 'Send Test'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
