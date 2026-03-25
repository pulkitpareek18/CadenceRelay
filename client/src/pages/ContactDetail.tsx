import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getContact, updateContact, Contact } from '../api/contacts.api';
import { useCustomVariables } from '../hooks/useCustomVariables';

interface SendHistoryItem {
  campaign_id: string;
  campaign_name: string;
  status: string;
  sent_at: string;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
}

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [history, setHistory] = useState<SendHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editMetadata, setEditMetadata] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { data: customVariables = [] } = useCustomVariables();

  function loadContact() {
    if (!id) return;
    getContact(id)
      .then((res) => {
        setContact(res.contact);
        setHistory(res.sendHistory);
      })
      .catch(() => toast.error('Failed to load contact'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadContact(); }, [id]);

  function openEditModal() {
    if (!contact) return;
    setEditName(contact.name || '');
    setEditEmail(contact.email);
    setEditStatus(contact.status);
    // Populate metadata values from contact
    const meta: Record<string, string> = {};
    for (const cv of customVariables) {
      meta[cv.key] = (contact.metadata?.[cv.key] as string) || '';
    }
    setEditMetadata(meta);
    setShowEditModal(true);
  }

  async function handleSaveEdit() {
    if (!id || !editEmail.trim()) return;
    setSaving(true);
    try {
      // Merge existing metadata with custom variable edits
      const mergedMetadata = { ...(contact?.metadata || {}), ...editMetadata };
      // Remove empty values
      for (const key of Object.keys(mergedMetadata)) {
        if (mergedMetadata[key] === '') delete mergedMetadata[key];
      }
      await updateContact(id, {
        email: editEmail,
        name: editName || null,
        status: editStatus,
        metadata: mergedMetadata,
      } as Partial<Contact>);
      toast.success('Contact updated');
      setShowEditModal(false);
      loadContact();
    } catch {
      toast.error('Failed to update contact');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex h-64 items-center justify-center text-gray-500">Loading...</div>;
  if (!contact) return <div className="p-6 text-gray-500">Contact not found</div>;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/contacts')} className="mb-4 text-sm text-primary-600 hover:text-primary-800">&larr; Back to Contacts</button>

      {/* Basic Info */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{contact.name || contact.email}</h1>
            <p className="text-gray-500">{contact.email}</p>
          </div>
          <button
            onClick={openEditModal}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <span className="text-sm text-gray-500">Status</span>
            <p className={`font-medium ${contact.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>{contact.status}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Emails Sent</span>
            <p className="font-medium">{contact.send_count}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Bounces</span>
            <p className="font-medium">{contact.bounce_count}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500">Last Sent</span>
            <p className="font-medium">{contact.last_sent_at ? new Date(contact.last_sent_at).toLocaleDateString() : 'Never'}</p>
          </div>
        </div>
      </div>

      {/* School Information */}
      {(contact.state || contact.district || contact.block || contact.classes || contact.category || contact.management || contact.address) && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">School Information</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {contact.state && (
              <div>
                <span className="text-sm text-gray-500">State</span>
                <p className="font-medium">{contact.state}</p>
              </div>
            )}
            {contact.district && (
              <div>
                <span className="text-sm text-gray-500">District</span>
                <p className="font-medium">{contact.district}</p>
              </div>
            )}
            {contact.block && (
              <div>
                <span className="text-sm text-gray-500">Block</span>
                <p className="font-medium">{contact.block}</p>
              </div>
            )}
            {contact.classes && (
              <div>
                <span className="text-sm text-gray-500">Classes</span>
                <p className="font-medium">{contact.classes}</p>
              </div>
            )}
            {contact.category && (
              <div>
                <span className="text-sm text-gray-500">Category</span>
                <p className="font-medium">{contact.category}</p>
              </div>
            )}
            {contact.management && (
              <div>
                <span className="text-sm text-gray-500">Management</span>
                <p className="font-medium">{contact.management}</p>
              </div>
            )}
            {contact.address && (
              <div className="sm:col-span-2 lg:col-span-3">
                <span className="text-sm text-gray-500">Address</span>
                <p className="font-medium">{contact.address}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Variables Data */}
      {customVariables.length > 0 && customVariables.some(cv => contact.metadata?.[cv.key]) && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Custom Data</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {customVariables.map((cv) => {
              const val = contact.metadata?.[cv.key];
              if (!val) return null;
              return (
                <div key={cv.id}>
                  <span className="text-sm text-gray-500">{cv.name}</span>
                  <p className="font-medium">{String(val)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lists */}
      {contact.lists && contact.lists.length > 0 && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Lists</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {contact.lists.map((l) => (
              <span
                key={l.id}
                onClick={() => navigate(`/lists/${l.id}`)}
                className="cursor-pointer rounded-full bg-primary-100 px-3 py-1 text-sm font-medium text-primary-700 hover:bg-primary-200"
              >
                {l.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Send History */}
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Send History</h2>
        {history.length === 0 ? (
          <p className="mt-4 text-center text-gray-400">No emails sent to this contact yet</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="mt-4 w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Campaign</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Sent</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Opened</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Clicked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((h, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2">{h.campaign_name}</td>
                  <td className="px-4 py-2">{h.status}</td>
                  <td className="px-4 py-2">{h.sent_at ? new Date(h.sent_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-2">{h.opened_at ? new Date(h.opened_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-2">{h.clicked_at ? new Date(h.clicked_at).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Edit Contact Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">Edit Contact</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                >
                  <option value="active">Active</option>
                  <option value="bounced">Bounced</option>
                  <option value="complained">Complained</option>
                  <option value="unsubscribed">Unsubscribed</option>
                </select>
              </div>
              {customVariables.length > 0 && (
                <>
                  <div className="border-t border-gray-200 pt-3 mt-1">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Custom Fields</p>
                  </div>
                  {customVariables.map((cv) => (
                    <div key={cv.id}>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {cv.name}{cv.required && ' *'}
                      </label>
                      {cv.type === 'select' ? (
                        <select
                          value={editMetadata[cv.key] || ''}
                          onChange={(e) => setEditMetadata({ ...editMetadata, [cv.key]: e.target.value })}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                        >
                          <option value="">-- Select --</option>
                          {cv.options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={cv.type === 'number' ? 'number' : cv.type === 'date' ? 'date' : 'text'}
                          value={editMetadata[cv.key] || ''}
                          onChange={(e) => setEditMetadata({ ...editMetadata, [cv.key]: e.target.value })}
                          placeholder={cv.default_value || ''}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                        />
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowEditModal(false)}
                disabled={saving}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editEmail.trim()}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
