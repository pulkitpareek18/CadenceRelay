import { useState, useEffect } from 'react';
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
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listTemplates().then(setTemplates).catch(() => {});
    listLists().then(setLists).catch(() => {});
  }, []);

  async function handleCreate() {
    setCreating(true);
    try {
      const campaign = await createCampaign({
        name, templateId, listId, provider, throttlePerSecond, throttlePerHour,
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
    }
  }

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const selectedList = lists.find((l) => l.id === listId);

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
              <button onClick={() => setScheduleType('now')} className={`rounded-lg px-4 py-2 text-sm ${scheduleType === 'now' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>Send Now</button>
              <button onClick={() => setScheduleType('later')} className={`rounded-lg px-4 py-2 text-sm ${scheduleType === 'later' ? 'bg-primary-600 text-white' : 'bg-gray-100'}`}>Schedule</button>
            </div>
          </div>
          {scheduleType === 'later' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Schedule Date & Time</label>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="mt-1 rounded-lg border px-3 py-2 text-sm" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Emails per Second</label>
              <input type="number" value={throttlePerSecond} onChange={(e) => setThrottlePerSecond(parseInt(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Emails per Hour</label>
              <input type="number" value={throttlePerHour} onChange={(e) => setThrottlePerHour(parseInt(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            At {throttlePerSecond} emails/sec, {selectedList?.contact_count || 0} emails will take ~{Math.ceil((selectedList?.contact_count || 0) / throttlePerSecond / 60)} minutes
          </p>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="rounded-lg border px-6 py-2 text-sm">Back</button>
            <button onClick={() => setStep(4)} className="rounded-lg bg-primary-600 px-6 py-2 text-sm text-white">Review</button>
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
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="rounded-lg border px-6 py-2 text-sm">Back</button>
            <button onClick={handleCreate} disabled={creating} className="rounded-lg bg-green-600 px-6 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50">
              {creating ? 'Creating...' : scheduleType === 'now' ? 'Send Now' : 'Schedule Campaign'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
