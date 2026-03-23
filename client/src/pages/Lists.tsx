import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SmartFilterCriteria, ContactList } from '../api/lists.api';
import { useListsList, useCreateList, useCreateSmartList, useDeleteList } from '../hooks/useLists';
import { useContactFilters } from '../hooks/useFilters';
import { GridCardSkeleton } from '../components/ui/Skeleton';
import ErrorBoundary from '../components/ErrorBoundary';

function ListsContent() {
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateSmart, setShowCreateSmart] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const navigate = useNavigate();

  const { data: lists = [], isLoading, isError } = useListsList();
  const createListMutation = useCreateList();
  const deleteListMutation = useDeleteList();

  async function handleCreate() {
    try {
      await createListMutation.mutateAsync({ name: newName, description: newDesc || undefined });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
    } catch {
      // error toast handled by mutation
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this list? Contacts will not be deleted.')) return;
    deleteListMutation.mutate(id);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Lists</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCreateSmart(true)} className="rounded-lg border border-primary-300 px-4 py-2 text-sm text-primary-700 hover:bg-primary-50">
            Create Smart List
          </button>
          <button onClick={() => setShowCreate(true)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">Create List</button>
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <GridCardSkeleton count={6} />
        ) : isError ? (
          <div className="rounded-xl bg-red-50 p-6 text-center">
            <p className="text-red-700 font-medium">Failed to load lists</p>
            <p className="mt-1 text-sm text-red-500">Please try refreshing the page.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lists.length === 0 ? (
              <p className="text-gray-400">No lists yet. Create your first list to organize contacts.</p>
            ) : lists.map((list: ContactList) => (
              <div key={list.id} className="cursor-pointer rounded-xl bg-white p-5 shadow-sm hover:shadow-md transition-shadow" onClick={() => navigate(`/lists/${list.id}`)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{list.name}</h3>
                    {list.is_smart && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">Smart</span>
                    )}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(list.id); }} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </div>
                {list.description && <p className="mt-1 text-sm text-gray-500">{list.description}</p>}
                {list.is_smart && list.filter_criteria && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {list.filter_criteria.state && list.filter_criteria.state.length > 0 && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        {list.filter_criteria.state.join(', ')}
                      </span>
                    )}
                    {list.filter_criteria.category && list.filter_criteria.category.length > 0 && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        {list.filter_criteria.category.length} categories
                      </span>
                    )}
                    {list.filter_criteria.management && list.filter_criteria.management.length > 0 && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        {list.filter_criteria.management.length} management types
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-1 text-sm text-gray-600">
                  <span className="font-medium">{list.contact_count?.toLocaleString()}</span> contacts
                  {list.is_smart && <span className="text-xs text-purple-500">(dynamic)</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Regular List Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="text-lg font-semibold">Create List</h3>
            <div className="mt-4 space-y-3">
              <input type="text" placeholder="List name" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
              <textarea placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={!newName} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Smart List Modal */}
      {showCreateSmart && (
        <SmartListModal
          onClose={() => setShowCreateSmart(false)}
          onCreated={() => { setShowCreateSmart(false); }}
        />
      )}
    </div>
  );
}

function SmartListModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState<SmartFilterCriteria>({
    state: [],
    district: [],
    block: [],
    category: [],
    management: [],
  });

  const { data: filters } = useContactFilters({
    state: criteria.state && criteria.state.length > 0 ? criteria.state.join(',') : undefined,
    district: criteria.district && criteria.district.length > 0 ? criteria.district.join(',') : undefined,
  });

  const createSmartListMutation = useCreateSmartList();

  function updateCriteria(field: keyof SmartFilterCriteria, value: string) {
    setCriteria((prev) => {
      const next = { ...prev };
      if (field === 'classes_min' || field === 'classes_max') {
        (next as Record<string, unknown>)[field] = value ? parseInt(value) : undefined;
      } else {
        (next as Record<string, string[]>)[field] = value ? [value] : [];
      }
      // Cascade: clear district when state changes
      if (field === 'state') {
        next.district = [];
        next.block = [];
      }
      if (field === 'district') {
        next.block = [];
      }
      return next;
    });
  }

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      // Clean up empty arrays
      const cleanCriteria: SmartFilterCriteria = {};
      if (criteria.state && criteria.state.length > 0) cleanCriteria.state = criteria.state;
      if (criteria.district && criteria.district.length > 0) cleanCriteria.district = criteria.district;
      if (criteria.block && criteria.block.length > 0) cleanCriteria.block = criteria.block;
      if (criteria.category && criteria.category.length > 0) cleanCriteria.category = criteria.category;
      if (criteria.management && criteria.management.length > 0) cleanCriteria.management = criteria.management;
      if (criteria.classes_min != null) cleanCriteria.classes_min = criteria.classes_min;
      if (criteria.classes_max != null) cleanCriteria.classes_max = criteria.classes_max;

      await createSmartListMutation.mutateAsync({
        name,
        description: description || undefined,
        filterCriteria: cleanCriteria,
      });
      onCreated();
    } catch {
      // error toast handled by mutation
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold">Create Smart List</h3>
        <p className="mt-1 text-sm text-gray-500">
          Smart lists automatically include contacts matching your filter criteria. They update dynamically as new contacts are imported.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name *</label>
            <input
              type="text"
              placeholder="e.g., Goa Private Schools"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <input
              type="text"
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>

          <hr className="my-4" />
          <h4 className="text-sm font-semibold text-gray-700">Filter Criteria</h4>

          {filters && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500">State</label>
                <select
                  value={criteria.state?.[0] || ''}
                  onChange={(e) => updateCriteria('state', e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All States</option>
                  {filters.states.map((s: string) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500">District</label>
                <select
                  value={criteria.district?.[0] || ''}
                  onChange={(e) => updateCriteria('district', e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All Districts</option>
                  {filters.districts.map((d: string) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500">Block</label>
                <select
                  value={criteria.block?.[0] || ''}
                  onChange={(e) => updateCriteria('block', e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All Blocks</option>
                  {filters.blocks.map((b: string) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500">Category</label>
                <select
                  value={criteria.category?.[0] || ''}
                  onChange={(e) => updateCriteria('category', e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All Categories</option>
                  {filters.categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500">Management</label>
                <select
                  value={criteria.management?.[0] || ''}
                  onChange={(e) => updateCriteria('management', e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All Management Types</option>
                  {filters.managements.map((m: string) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500">Classes Min</label>
                  <input
                    type="number"
                    placeholder="e.g., 1"
                    value={criteria.classes_min ?? ''}
                    onChange={(e) => updateCriteria('classes_min', e.target.value)}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500">Classes Max</label>
                  <input
                    type="number"
                    placeholder="e.g., 12"
                    value={criteria.classes_max ?? ''}
                    onChange={(e) => updateCriteria('classes_max', e.target.value)}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || createSmartListMutation.isPending}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {createSmartListMutation.isPending ? 'Creating...' : 'Create Smart List'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Lists() {
  return (
    <ErrorBoundary>
      <ListsContent />
    </ErrorBoundary>
  );
}
