import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getContact, Contact } from '../api/contacts.api';

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
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    getContact(id)
      .then((res) => {
        setContact(res.contact);
        setHistory(res.sendHistory);
      })
      .catch(() => toast.error('Failed to load contact'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="flex h-64 items-center justify-center text-gray-500">Loading...</div>;
  if (!contact) return <div className="p-6 text-gray-500">Contact not found</div>;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/contacts')} className="mb-4 text-sm text-primary-600 hover:text-primary-800">&larr; Back to Contacts</button>

      {/* Basic Info */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{contact.name || contact.email}</h1>
        <p className="text-gray-500">{contact.email}</p>
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
    </div>
  );
}
