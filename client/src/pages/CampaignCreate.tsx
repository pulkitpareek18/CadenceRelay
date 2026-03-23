import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { createCampaign, scheduleCampaign, sendCampaign } from '../api/campaigns.api';
import { listTemplates, Template } from '../api/templates.api';
import { listLists, ContactList } from '../api/lists.api';

export default function CampaignCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);

  // Form state
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [listId, setListId] = useState('');
  const [provider, setProvider] = useState<'gmail' | 'ses'>('ses');
  const [throttlePerSecond, setThrottlePerSecond] = useState(5);
  const [throttlePerHour, setThrottlePerHour] = useState(5000);
  const [scheduleType, setScheduleType] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [creating, setCreating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);

  const previewRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listTemplates().then(setTemplates).catch(() => {});
    listLists().then(setLists).catch(() => {});
  }, []);

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const selectedList = lists.find((l) => l.id === listId);

  // Update preview iframe when template changes
  useEffect(() => {
    if (previewRef.current && selectedTemplate) {
      const doc = previewRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(selectedTemplate.html_body);
        doc.close();
      }
    }
  }, [selectedTemplate]);

  function validateScheduleDate(): boolean {
    if (scheduleType === 'later') {
      if (!scheduledAt) {
        setScheduleError('Please select a date and time');
        return false;
      }
      const selected = new Date(scheduledAt);
      if (selected <= new Date()) {
        setScheduleError('Scheduled date must be in the future');
        return false;
      }
    }
    setScheduleError('');
    return true;
  }

  function handleGoToReview() {
    if (!validateScheduleDate()) return;
    setStep(4);
  }

  async function handleCreate() {
    if (scheduleType === 'later' && !validateScheduleDate()) return;

    setCreating(true);
    try {
      const campaign = await createCampaign({
        name, templateId, listId, provider, throttlePerSecond, throttlePerHour,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (scheduleType === 'later' && scheduledAt) {
        await scheduleCampaign(campaign.id, new Date(scheduledAt).toISOString());
        toast.success('Campaign scheduled');
      } else {
        await sendCampaign(campaign.id);
        toast.success('Campaign sending started');
      }

      navigate(`/campaigns/${campaign.id}`);
    } catch {
      toast.error('Failed to create campaign');
    } finally {
      setCreating(false);
      setShowConfirm(false);
    }
  }

  const contactCount = selectedList?.contact_count || 0;
  const estimatedMinutes = Math.ceil(contactCount / throttlePerSecond / 60);
  const estimatedHours = Math.floor(estimatedMinutes / 60);
  const estimatedMinsRemainder = estimatedMinutes % 60;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <button onClick={() => navigate('/campaigns')} className="mb-4 text-sm text-primary-600">&larr; Back</button>
      <h1 className="text-2xl font-bold">Create Campaign</h1>

      {/* Step indicators */}
      <div className="mt-6 flex gap-2">
        {['Details', 'Template', 'Schedule', 'Review'].map((label, i) => (
          <div key={label} className={`flex-1 rounded-lg py-2 text-center text-sm font-medium ${step === i + 1 ? 'bg-primary-600 text-white' : step > i + 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {label}
          </div>
        ))}
      </div>

      {/* Step 1: Details */}
      {step === 1 && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Campaign Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Goa Schools March Invite" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Contact List</label>
            <select value={listId} onChange={(e) => setListId(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
              <option value="">Select a list</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.contact_count} contacts)</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email Provider</label>
            <div className="mt-1 flex gap-3">
              <button onClick={() => setProvider('ses')} className={`rounded-lg px-4 py-2 text-sm ${provider === 'ses' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>AWS SES</button>
              <button onClick={() => setProvider('gmail')} className={`rounded-lg px-4 py-2 text-sm ${provider === 'gmail' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>Gmail</button>
            </div>
          </div>
          {/* Attachments */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Attachments (optional)</label>
            <p className="mt-0.5 text-xs text-gray-500">Add files to send with every email (max 25MB each, up to 10 files)</p>
            <div className="mt-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  setAttachments((prev) => [...prev, ...files]);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50"
              >
                + Add Files
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map((file, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                      <span>{file.name}</span>
                      <span className="text-xs text-gray-400">({(file.size / 1024).toFixed(0)} KB)</span>
                    </div>
                    <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-xs text-red-500 hover:text-red-700">Remove</button>
                  </div>
                ))}
                <p className="text-xs text-gray-400">{attachments.length} file(s), {(attachments.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB total</p>
              </div>
            )}
          </div>
          <button disabled={!name || !listId} onClick={() => setStep(2)} className="rounded-lg bg-primary-600 px-6 py-2 text-sm text-white disabled:opacity-50">Next</button>
        </div>
      )}

      {/* Step 2: Template */}
      {step === 2 && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm space-y-4">
          <label className="block text-sm font-medium text-gray-700">Select Template</label>
          <div className="grid grid-cols-2 gap-3">
            {templates.map((t) => (
              <div key={t.id} onClick={() => setTemplateId(t.id)} className={`cursor-pointer rounded-lg border-2 p-4 ${templateId === t.id ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <h4 className="font-medium">{t.name}</h4>
                <p className="text-sm text-gray-500 truncate">{t.subject}</p>
              </div>
            ))}
          </div>
          {/* Template Preview */}
          {selectedTemplate && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Template Preview</h4>
              <div className="rounded-lg border bg-gray-50 p-2">
                <div className="mb-2 text-xs text-gray-500">
                  <span className="font-medium">Subject:</span> {selectedTemplate.subject}
                </div>
                <iframe
                  ref={previewRef}
                  className="h-64 w-full rounded border bg-white"
                  title="Template Preview"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="rounded-lg border px-6 py-2 text-sm">Back</button>
            <button disabled={!templateId} onClick={() => setStep(3)} className="rounded-lg bg-primary-600 px-6 py-2 text-sm text-white disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

      {/* Step 3: Schedule */}
      {step === 3 && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">When to send?</label>
            <div className="mt-2 flex gap-3">
              <button onClick={() => { setScheduleType('now'); setScheduleError(''); }} className={`rounded-lg px-4 py-2 text-sm ${scheduleType === 'now' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>Send Now</button>
              <button onClick={() => setScheduleType('later')} className={`rounded-lg px-4 py-2 text-sm ${scheduleType === 'later' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>Schedule</button>
            </div>
          </div>
          {scheduleType === 'later' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Schedule Date & Time</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => { setScheduledAt(e.target.value); setScheduleError(''); }}
                min={new Date().toISOString().slice(0, 16)}
                className={`mt-1 rounded-lg border px-3 py-2 text-sm ${scheduleError ? 'border-red-300' : ''}`}
              />
              {scheduleError && <p className="mt-1 text-xs text-red-500">{scheduleError}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Emails per Second</label>
              <input type="number" value={throttlePerSecond} onChange={(e) => setThrottlePerSecond(parseInt(e.target.value) || 1)} min={1} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Emails per Hour</label>
              <input type="number" value={throttlePerHour} onChange={(e) => setThrottlePerHour(parseInt(e.target.value) || 1)} min={1} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Estimated time - more visible */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-sm font-medium text-blue-800">Estimated send time</span>
            </div>
            <p className="mt-1 text-lg font-semibold text-blue-900">
              {contactCount === 0
                ? 'No contacts in selected list'
                : estimatedHours > 0
                  ? `~${estimatedHours}h ${estimatedMinsRemainder}m for ${contactCount.toLocaleString()} emails`
                  : `~${estimatedMinutes} minute(s) for ${contactCount.toLocaleString()} emails`}
            </p>
            <p className="mt-0.5 text-xs text-blue-600">At {throttlePerSecond} emails/sec</p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="rounded-lg border px-6 py-2 text-sm">Back</button>
            <button onClick={handleGoToReview} className="rounded-lg bg-primary-600 px-6 py-2 text-sm text-white">Review</button>
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm space-y-4">
          <h3 className="font-semibold">Campaign Summary</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Name:</span> <span className="font-medium">{name}</span></div>
            <div><span className="text-gray-500">Provider:</span> <span className="font-medium uppercase">{provider}</span></div>
            <div><span className="text-gray-500">Template:</span> <span className="font-medium">{selectedTemplate?.name}</span></div>
            <div><span className="text-gray-500">List:</span> <span className="font-medium">{selectedList?.name} ({selectedList?.contact_count} contacts)</span></div>
            <div><span className="text-gray-500">Schedule:</span> <span className="font-medium">{scheduleType === 'now' ? 'Send immediately' : new Date(scheduledAt).toLocaleString()}</span></div>
            <div><span className="text-gray-500">Throttle:</span> <span className="font-medium">{throttlePerSecond}/sec, {throttlePerHour}/hr</span></div>
          </div>

          {/* Attachments in review */}
          {attachments.length > 0 && (
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              <span className="text-gray-500">Attachments:</span>
              <ul className="mt-1 space-y-0.5">
                {attachments.map((f, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    <span className="font-medium">{f.name}</span>
                    <span className="text-gray-400">({(f.size / 1024).toFixed(0)} KB)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Estimated time in review */}
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <span className="text-gray-500">Estimated time:</span>{' '}
            <span className="font-medium">
              {estimatedHours > 0
                ? `~${estimatedHours}h ${estimatedMinsRemainder}m`
                : `~${estimatedMinutes} minute(s)`}
            </span>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="rounded-lg border px-6 py-2 text-sm">Back</button>
            <button onClick={() => setShowConfirm(true)} disabled={creating} className="rounded-lg bg-green-600 px-6 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50">
              {creating ? 'Creating...' : scheduleType === 'now' ? 'Send Now' : 'Schedule Campaign'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold text-gray-900">
              {scheduleType === 'now' ? 'Confirm Send' : 'Confirm Schedule'}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {scheduleType === 'now'
                ? `This will immediately start sending ${contactCount.toLocaleString()} emails using ${provider.toUpperCase()}. This action cannot be undone.`
                : `This will schedule ${contactCount.toLocaleString()} emails to be sent on ${new Date(scheduledAt).toLocaleString()} using ${provider.toUpperCase()}.`}
            </p>
            <div className="mt-4 rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
              <strong>Campaign:</strong> {name}<br />
              <strong>Template:</strong> {selectedTemplate?.name}<br />
              <strong>List:</strong> {selectedList?.name} ({contactCount} contacts)
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50">
                {creating ? 'Processing...' : 'Yes, proceed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
