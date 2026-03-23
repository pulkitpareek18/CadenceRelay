import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  listContacts,
  exportContacts,
  createContact,
  deleteContact,
  bulkDeleteContacts,
  getContactFilters,
  Contact,
  ContactFilters,
} from '../api/contacts.api';
import { listLists, createSmartList, ContactList } from '../api/lists.api';
import AdminPasswordModal from '../components/ui/AdminPasswordModal';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [listFilter, setListFilter] = useState('');

  // School filters
  const [stateFilter, setStateFilter] = useState('');
  const [districtFilter, setDistrictFilter] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [managementFilter, setManagementFilter] = useState('');
  const [filters, setFilters] = useState<ContactFilters | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newListId, setNewListId] = useState('');
  const [emailError, setEmailError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteModal, setDeleteModal] = useState<{ type: 'single' | 'bulk'; id?: string } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const navigate = useNavigate();

  // Fetch filter options
  const fetchFilters = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (stateFilter) params.state = stateFilter;
      if (districtFilter) params.district = districtFilter;
      const f = await getContactFilters(params);
      setFilters(f);
    } catch {
      // silently fail
    }
  }, [stateFilter, districtFilter]);

  useEffect(() => { fetchFilters(); }, [fetchFilters]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '50' };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (listFilter) params.listId = listFilter;
      if (stateFilter) params.state = stateFilter;
      if (districtFilter) params.district = districtFilter;
      if (blockFilter) params.block = blockFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (managementFilter) params.management = managementFilter;
      const res = await listContacts(params);
      setContacts(res.data);
      setTotal(res.pagination.total);
    } catch {
      toast.error('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, listFilter, stateFilter, districtFilter, blockFilter, categoryFilter, managementFilter]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);
  useEffect(() => { listLists().then(setLists).catch(() => {}); }, []);

  // Clear selection when page/filters change
  useEffect(() => { setSelectedIds(new Set()); }, [page, search, statusFilter, listFilter, stateFilter, districtFilter, blockFilter, categoryFilter, managementFilter]);

  // Reset cascading filters
  useEffect(() => { setDistrictFilter(''); setBlockFilter(''); }, [stateFilter]);
  useEffect(() => { setBlockFilter(''); }, [districtFilter]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  }

  async function handleAdd() {
    if (!newEmail.trim()) {
      setEmailError('Email is required');
      return;
    }
    if (!isValidEmail(newEmail)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    setEmailError('');
    try {
      await createContact({ email: newEmail, name: newName || undefined, listIds: newListId ? [newListId] : undefined });
      toast.success('Contact added');
      setShowAddModal(false);
      setNewEmail('');
      setNewName('');
      setNewListId('');
      setEmailError('');
      fetchContacts();
    } catch {
      toast.error('Failed to add contact');
    }
  }

  async function handleDeleteConfirm(password: string) {
    if (!deleteModal) return;

    if (deleteModal.type === 'single' && deleteModal.id) {
      await deleteContact(deleteModal.id, password);
      toast.success('Contact deleted');
    } else if (deleteModal.type === 'bulk') {
      const ids = Array.from(selectedIds);
      await bulkDeleteContacts(ids, password);
      toast.success(`${ids.length} contact(s) deleted`);
      setSelectedIds(new Set());
    }

    setDeleteModal(null);
    fetchContacts();
  }

  const activeFilterCount = [stateFilter, districtFilter, blockFilter, categoryFilter, managementFilter].filter(Boolean).length;

  function clearAllFilters() {
    setStateFilter('');
    setDistrictFilter('');
    setBlockFilter('');
    setCategoryFilter('');
    setManagementFilter('');
    setPage(1);
  }

  async function handleCreateSmartList() {
    const filterCriteria: Record<string, unknown> = {};
    if (stateFilter) filterCriteria.state = stateFilter.split(',');
    if (districtFilter) filterCriteria.district = districtFilter.split(',');
    if (blockFilter) filterCriteria.block = blockFilter.split(',');
    if (categoryFilter) filterCriteria.category = categoryFilter.split(',');
    if (managementFilter) filterCriteria.management = managementFilter.split(',');

    const name = prompt('Enter a name for this smart list:');
    if (!name) return;

    try {
      await createSmartList({
        name,
        description: `Auto-generated smart list with ${activeFilterCount} filter(s)`,
        filterCriteria,
      });
      toast.success('Smart list created');
      listLists().then(setLists).catch(() => {});
    } catch {
      toast.error('Failed to create smart list');
    }
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setDeleteModal({ type: 'bulk' })}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
            >
              Delete Selected ({selectedIds.size})
            </button>
          )}
          <button onClick={() => exportContacts(listFilter || undefined)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Export CSV</button>
          <button onClick={() => navigate('/import')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Import CSV</button>
          <button onClick={() => setShowAddModal(true)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">Add Contact</button>
        </div>
      </div>

      {/* Search + Status + List filters */}
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
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}{l.is_smart ? ' (Smart)' : ''}</option>)}
        </select>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-sm ${
            activeFilterCount > 0
              ? 'border-primary-300 bg-primary-50 text-primary-700'
              : 'border-gray-300 hover:bg-gray-50'
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-xs text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* School Filter Bar */}
      {showFilters && filters && (
        <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">School Filters</h3>
            <div className="flex gap-2">
              {activeFilterCount > 0 && (
                <button onClick={handleCreateSmartList} className="text-xs text-primary-600 hover:text-primary-800">
                  Create Smart List from Filters
                </button>
              )}
              {activeFilterCount > 0 && (
                <button onClick={clearAllFilters} className="text-xs text-gray-500 hover:text-gray-700">
                  Clear all
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">State</label>
              <select
                value={stateFilter}
                onChange={(e) => { setStateFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">All States</option>
                {filters.states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">District</label>
              <select
                value={districtFilter}
                onChange={(e) => { setDistrictFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">All Districts</option>
                {filters.districts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Block</label>
              <select
                value={blockFilter}
                onChange={(e) => { setBlockFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">All Blocks</option>
                {filters.blocks.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">All Categories</option>
                {filters.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Management</label>
              <select
                value={managementFilter}
                onChange={(e) => { setManagementFilter(e.target.value); setPage(1); }}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">All Management</option>
                {filters.managements.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {stateFilter && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                  State: {stateFilter}
                  <button onClick={() => setStateFilter('')} className="ml-0.5 hover:text-primary-900">&times;</button>
                </span>
              )}
              {districtFilter && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                  District: {districtFilter}
                  <button onClick={() => setDistrictFilter('')} className="ml-0.5 hover:text-primary-900">&times;</button>
                </span>
              )}
              {blockFilter && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                  Block: {blockFilter}
                  <button onClick={() => setBlockFilter('')} className="ml-0.5 hover:text-primary-900">&times;</button>
                </span>
              )}
              {categoryFilter && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                  Category: {categoryFilter}
                  <button onClick={() => setCategoryFilter('')} className="ml-0.5 hover:text-primary-900">&times;</button>
                </span>
              )}
              {managementFilter && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                  Management: {managementFilter}
                  <button onClick={() => setManagementFilter('')} className="ml-0.5 hover:text-primary-900">&times;</button>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contact count summary */}
      <div className="mt-3 text-sm text-gray-500">
        {total.toLocaleString()} contact{total !== 1 ? 's' : ''} found
      </div>

      {/* Table */}
      <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={contacts.length > 0 && selectedIds.size === contacts.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">State</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">District</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Category</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Sent</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <div className="text-gray-400">
                      <p className="text-lg font-medium">No contacts found</p>
                      <p className="mt-1 text-sm">
                        {search || statusFilter || listFilter || activeFilterCount > 0
                          ? 'Try adjusting your search filters'
                          : 'Get started by adding your first contact or importing a CSV file'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : contacts.map((c) => (
                <tr key={c.id} className={`hover:bg-gray-50 cursor-pointer ${selectedIds.has(c.id) ? 'bg-primary-50' : ''}`}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate" onClick={() => navigate(`/contacts/${c.id}`)} title={c.name || ''}>{c.name || '-'}</td>
                  <td className="px-4 py-3" onClick={() => navigate(`/contacts/${c.id}`)}>{c.email}</td>
                  <td className="px-4 py-3 text-xs" onClick={() => navigate(`/contacts/${c.id}`)}>{c.state || '-'}</td>
                  <td className="px-4 py-3 text-xs" onClick={() => navigate(`/contacts/${c.id}`)}>{c.district || '-'}</td>
                  <td className="px-4 py-3 text-xs max-w-[150px] truncate" onClick={() => navigate(`/contacts/${c.id}`)} title={c.category || ''}>{c.category || '-'}</td>
                  <td className="px-4 py-3" onClick={() => navigate(`/contacts/${c.id}`)}>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.status === 'active' ? 'bg-green-100 text-green-700' :
                      c.status === 'bounced' ? 'bg-red-100 text-red-700' :
                      c.status === 'complained' ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3" onClick={() => navigate(`/contacts/${c.id}`)}>{c.send_count}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteModal({ type: 'single', id: c.id }); }}
                      className="text-red-600 hover:text-red-800 text-xs"
                    >
                      Delete
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
          <span>{total.toLocaleString()} contacts total</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-50 hover:bg-gray-50">Prev</button>
            <span className="px-3 py-1">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-50 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <AdminPasswordModal
          title={
            deleteModal.type === 'single'
              ? 'Delete contact?'
              : `Delete ${selectedIds.size} contact(s)?`
          }
          description="This action cannot be undone. The contact(s) will be permanently removed. Historical send data will be preserved."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteModal(null)}
        />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">Add Contact</h3>
            <div className="mt-4 space-y-3">
              <div>
                <input
                  type="email"
                  placeholder="Email *"
                  value={newEmail}
                  onChange={(e) => { setNewEmail(e.target.value); setEmailError(''); }}
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${emailError ? 'border-red-300 focus:border-red-500' : 'focus:border-primary-500'} focus:outline-none`}
                />
                {emailError && <p className="mt-1 text-xs text-red-500">{emailError}</p>}
              </div>
              <input type="text" placeholder="Name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
              <select value={newListId} onChange={(e) => setNewListId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
                <option value="">No list</option>
                {lists.filter(l => !l.is_smart).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setShowAddModal(false); setEmailError(''); setNewEmail(''); setNewName(''); setNewListId(''); }} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleAdd} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
