import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { listContacts, importContacts, exportContacts, createContact, deleteContact, Contact } from '../api/contacts.api';
import { listLists, ContactList } from '../api/lists.api';

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const navigate = useNavigate();

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '50' };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (listFilter) params.listId = listFilter;
      const res = await listContacts(params);
      setContacts(res.data);
      setTotal(res.pagination.total);
    } catch {
      toast.error('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, listFilter]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);
  useEffect(() => { listLists().then(setLists).catch(() => {}); }, []);

  async function handleAdd() {
    try {
      await createContact({ email: newEmail, name: newName || undefined });
      toast.success('Contact added');
      setShowAddModal(false);
      setNewEmail('');
      setNewName('');
      fetchContacts();
    } catch {
      toast.error('Failed to add contact');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this contact?')) return;
    try {
      await deleteContact(id);
      toast.success('Contact deleted');
      fetchContacts();
    } catch {
      toast.error('Failed to delete');
    }
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
        <div className="flex gap-2">
          <button onClick={() => exportContacts(listFilter || undefined)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Export CSV</button>
          <button onClick={() => setShowImportModal(true)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Import CSV</button>
          <button onClick={() => setShowAddModal(true)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">Add Contact</button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex gap-3">
        <input
          type="text"
          placeholder="Search email or name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="bounced">Bounced</option>
          <option value="complained">Complained</option>
          <option value="unsubscribed">Unsubscribed</option>
        </select>
        <select
          value={listFilter}
          onChange={(e) => { setListFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Lists</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Sent</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Bounced</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No contacts found</td></tr>
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
                <td className="px-4 py-3">{c.bounce_count}</td>
                <td className="px-4 py-3">
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>{total} contacts total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Prev</button>
            <span className="px-3 py-1">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && <ImportModal lists={lists} onClose={() => setShowImportModal(false)} onDone={() => { setShowImportModal(false); fetchContacts(); }} />}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">Add Contact</h3>
            <div className="mt-4 space-y-3">
              <input type="email" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
              <input type="text" placeholder="Name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowAddModal(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleAdd} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportModal({ lists, onClose, onDone }: { lists: ContactList[]; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [listId, setListId] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    try {
      const res = await importContacts(file, listId || undefined);
      setResult(res);
      toast.success(`Imported ${res.imported} contacts`);
      onDone();
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6">
        <h3 className="text-lg font-semibold">Import Contacts from CSV</h3>
        <p className="mt-1 text-sm text-gray-500">CSV must have an "email" column. Optional: "name" column.</p>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-8">
            <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <select value={listId} onChange={(e) => setListId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
            <option value="">No list (import only)</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {result && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
            <p>Imported: {result.imported} | Skipped: {result.skipped}</p>
            {result.errors.length > 0 && (
              <details className="mt-1">
                <summary className="text-red-600 cursor-pointer">Errors ({result.errors.length})</summary>
                <ul className="mt-1 text-xs text-red-500">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Close</button>
          <button onClick={handleImport} disabled={!file || importing} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50">
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
