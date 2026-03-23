import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { listLists, createList, deleteList, ContactList } from '../api/lists.api';

export default function Lists() {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const navigate = useNavigate();

  async function fetchLists() {
    try {
      const data = await listLists();
      setLists(data);
    } catch {
      toast.error('Failed to load lists');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchLists(); }, []);

  async function handleCreate() {
    try {
      await createList({ name: newName, description: newDesc || undefined });
      toast.success('List created');
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      fetchLists();
    } catch {
      toast.error('Failed to create list');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this list? Contacts will not be deleted.')) return;
    try {
      await deleteList(id);
      toast.success('List deleted');
      fetchLists();
    } catch {
      toast.error('Failed to delete');
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Lists</h1>
        <button onClick={() => setShowCreate(true)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">Create List</button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : lists.length === 0 ? (
          <p className="text-gray-400">No lists yet. Create your first list to organize contacts.</p>
        ) : lists.map((list) => (
          <div key={list.id} className="cursor-pointer rounded-xl bg-white p-5 shadow-sm hover:shadow-md transition-shadow" onClick={() => navigate(`/lists/${list.id}`)}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{list.name}</h3>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(list.id); }} className="text-xs text-red-500 hover:text-red-700">Delete</button>
            </div>
            {list.description && <p className="mt-1 text-sm text-gray-500">{list.description}</p>}
            <div className="mt-3 flex items-center gap-1 text-sm text-gray-600">
              <span className="font-medium">{list.contact_count}</span> contacts
            </div>
          </div>
        ))}
      </div>

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
    </div>
  );
}
