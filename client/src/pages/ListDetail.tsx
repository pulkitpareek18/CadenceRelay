import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getList, updateList, addContactsToList, removeContactsFromList, ContactList } from '../api/lists.api';
import { listContacts, Contact } from '../api/contacts.api';

export default function ListDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [list, setList] = useState<ContactList | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<Contact[]>([]);
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addLoading, setAddLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const fetchList = useCallback(async () => {
    if (!id) return;
    try {
      const params: Record<string, string> = { page: String(page), limit: '50' };
      if (search) params.search = search;
      const res = await getList(id, params);
      setList(res.list);
      setContacts(res.contacts?.data || []);
      setTotal(res.contacts?.pagination?.total || 0);
    } catch {
      toast.error('Failed to load list');
    } finally {
      setLoading(false);
    }
  }, [id, page, search]);

  useEffect(() => { fetchList(); }, [fetchList]);

  async function handleRemoveContact(contactId: string) {
    if (!id) return;
    if (!confirm('Remove this contact from the list?')) return;
    try {
      await removeContactsFromList(id, [contactId]);
      toast.success('Contact removed from list');
      fetchList();
    } catch {
      toast.error('Failed to remove contact');
    }
  }

  async function handleEditSave() {
    if (!id || !editName.trim()) return;
    try {
      await updateList(id, { name: editName, description: editDesc || undefined });
      toast.success('List updated');
      setShowEditModal(false);
      fetchList();
    } catch {
      toast.error('Failed to update list');
    }
  }

  function openEditModal() {
    if (!list) return;
    setEditName(list.name);
    setEditDesc(list.description || '');
    setShowEditModal(true);
  }

  async function handleAddSearch() {
    if (!addSearch.trim()) return;
    setAddLoading(true);
    try {
      const res = await listContacts({ search: addSearch, limit: '20' });
      setAddResults(res.data || []);
    } catch {
      toast.error('Failed to search contacts');
    } finally {
      setAddLoading(false);
    }
  }

  function toggleAddSelect(contactId: string) {
    setAddSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  async function handleAddContacts() {
    if (!id || addSelected.size === 0) return;
    setAdding(true);
    try {
      await addContactsToList(id, Array.from(addSelected));
      toast.success(`Added ${addSelected.size} contact(s) to list`);
      setShowAddModal(false);
      setAddSearch('');
      setAddResults([]);
      setAddSelected(new Set());
      fetchList();
    } catch {
      toast.error('Failed to add contacts');
    } finally {
      setAdding(false);
    }
  }

  const totalPages = Math.ceil(total / 50);

  if (loading) return <div className="flex h-64 items-center justify-center text-gray-500">Loading...</div>;
  if (!list) return <div className="p-6 text-gray-500">List not found</div>;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/lists')} className="mb-4 text-sm text-primary-600 hover:text-primary-800">&larr; Back to Lists</button>

      {/* List header */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{list.name}</h1>
            {list.description && <p className="mt-1 text-sm text-gray-500">{list.description}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={openEditModal} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">Edit</button>
            <button onClick={() => setShowAddModal(true)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">Add Contacts</button>
          </div>
        </div>
        <div className="mt-4 flex gap-6 text-sm text-gray-600">
          <div><span className="font-medium text-gray-900">{list.contact_count}</span> contacts</div>
          <div>Created {new Date(list.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      {/* Search bar */}
      <div className="mt-4">
        <input
          type="text"
          placeholder="Search contacts in this list..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        />
      </div>

      {/* Contacts table */}
      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Sent</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="text-gray-400">
                      <p className="text-lg font-medium">No contacts in this list</p>
                      <p className="mt-1 text-sm">Add contacts using the button above</p>
                    </div>
                  </td>
                </tr>
              ) : contacts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/contacts/${c.id}`)}>
                  <td className="px-4 py-3">{c.email}</td>
                  <td className="px-4 py-3">{c.name || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.status === 'active' ? 'bg-green-100 text-green-700' :
                      c.status === 'bounced' ? 'bg-red-100 text-red-700' :
                      c.status === 'complained' ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3">{c.send_count}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveContact(c.id); }}
                      className="text-red-600 hover:text-red-800 text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>{total} contacts total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-50 hover:bg-gray-50">Prev</button>
            <span className="px-3 py-1">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-50 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">Edit List</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={3} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowEditModal(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleEditSave} disabled={!editName.trim()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Contacts Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">Add Contacts to List</h3>
            <p className="mt-1 text-sm text-gray-500">Search for existing contacts to add to this list.</p>
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                placeholder="Search by email or name..."
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSearch()}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
              />
              <button onClick={handleAddSearch} disabled={addLoading} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">
                {addLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
            {addResults.length > 0 && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border">
                {addResults.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                    <input
                      type="checkbox"
                      checked={addSelected.has(c.id)}
                      onChange={() => toggleAddSelect(c.id)}
                      className="rounded border-gray-300"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{c.email}</p>
                      {c.name && <p className="text-xs text-gray-500 truncate">{c.name}</p>}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                    }`}>{c.status}</span>
                  </label>
                ))}
              </div>
            )}
            {addSelected.size > 0 && (
              <p className="mt-2 text-sm text-primary-600 font-medium">{addSelected.size} contact(s) selected</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setShowAddModal(false); setAddSearch(''); setAddResults([]); setAddSelected(new Set()); }} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleAddContacts} disabled={addSelected.size === 0 || adding} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50">
                {adding ? 'Adding...' : `Add ${addSelected.size > 0 ? addSelected.size : ''} Contact(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
