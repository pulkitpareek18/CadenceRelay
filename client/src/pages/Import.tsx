import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { previewCSV, importContactsCSV, CSVPreviewResult, CSVImportResult } from '../api/contacts.api';
import { listLists, ContactList } from '../api/lists.api';

const DB_COLUMNS = [
  { value: '', label: '-- Skip --' },
  { value: 'email', label: 'Email' },
  { value: 'name', label: 'Name / School Name' },
  { value: 'state', label: 'State' },
  { value: 'district', label: 'District' },
  { value: 'block', label: 'Block' },
  { value: 'classes', label: 'Classes' },
  { value: 'category', label: 'Category' },
  { value: 'management', label: 'Management' },
  { value: 'address', label: 'Address' },
];

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CSVPreviewResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [listId, setListId] = useState('');
  const [lists, setLists] = useState<ContactList[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<CSVImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listLists().then(setLists).catch(() => {});
  }, []);

  const handleFile = useCallback(async (f: File) => {
    if (!f.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }
    setFile(f);
    setResult(null);
    setUploadProgress(0);
    try {
      const prev = await previewCSV(f);
      setPreview(prev);
      // Initialize column mapping from auto-detected values
      setColumnMapping(prev.autoMapping);
    } catch {
      toast.error('Failed to preview CSV file');
    }
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function updateMapping(header: string, dbColumn: string) {
    setColumnMapping((prev) => {
      const next = { ...prev };
      if (dbColumn) {
        next[header] = dbColumn;
      } else {
        delete next[header];
      }
      return next;
    });
  }

  async function handleImport() {
    if (!file) return;

    // Validate that email column is mapped
    const hasEmail = Object.values(columnMapping).includes('email');
    if (!hasEmail) {
      toast.error('You must map at least one column to "Email"');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const res = await importContactsCSV(file, listId || undefined, columnMapping, setUploadProgress);
      setResult(res);
      toast.success(`Imported ${res.imported} contacts`);
    } catch {
      toast.error('Import failed');
    } finally {
      setUploading(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setColumnMapping({});
    setResult(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Import Contacts</h1>
      <p className="mt-1 text-sm text-gray-500">
        Upload a CSV file with school/contact data. Supports large files with 280,000+ rows.
      </p>

      {/* Step 1: File Upload */}
      {!preview && !result && (
        <div className="mt-6">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
              dragOver
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-300 bg-white hover:border-primary-400 hover:bg-gray-50'
            }`}
          >
            <svg className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-3 text-sm font-medium text-gray-700">
              Drop your CSV file here, or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Supports: school_name, email, address, state, district, block, classes, category, management
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        </div>
      )}

      {/* Step 2: Preview + Column Mapping */}
      {preview && !result && (
        <div className="mt-6 space-y-6">
          {/* File info */}
          <div className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100">
                <svg className="h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900">{file?.name}</p>
                <p className="text-sm text-gray-500">
                  {preview.totalRows.toLocaleString()} rows detected | {preview.headers.length} columns
                </p>
              </div>
            </div>
            <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700">
              Change file
            </button>
          </div>

          {/* Column Mapping */}
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Column Mapping</h2>
            <p className="mt-1 text-sm text-gray-500">
              Map CSV columns to contact fields. Auto-detected mappings are pre-filled.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.headers.map((header) => (
                <div key={header} className="flex items-center gap-2">
                  <span className="w-32 truncate text-sm font-medium text-gray-700" title={header}>
                    {header}
                  </span>
                  <svg className="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <select
                    value={columnMapping[header] || ''}
                    onChange={(e) => updateMapping(header, e.target.value)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-sm ${
                      columnMapping[header] ? 'border-primary-300 bg-primary-50' : 'border-gray-300'
                    }`}
                  >
                    {DB_COLUMNS.map((col) => (
                      <option key={col.value} value={col.value}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview Table */}
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Preview (first 10 rows)</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-3 py-2 text-left font-medium text-gray-600">
                        <div>{h}</div>
                        {columnMapping[h] && (
                          <div className="mt-0.5 text-xs font-normal text-primary-600">
                            {DB_COLUMNS.find((c) => c.value === columnMapping[h])?.label}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.previewRows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {row.map((cell, j) => (
                        <td key={j} className="whitespace-nowrap px-3 py-2 text-gray-700">
                          {cell || <span className="text-gray-300">--</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Options + Import Button */}
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700">Add to List (optional)</label>
                <select
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:max-w-xs"
                >
                  <option value="">No list - import contacts only</option>
                  {lists.filter(l => !l.is_smart).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={reset} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={uploading || !Object.values(columnMapping).includes('email')}
                  className="rounded-lg bg-primary-600 px-6 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {uploading ? 'Importing...' : `Import ${preview.totalRows.toLocaleString()} Contacts`}
                </button>
              </div>
            </div>

            {/* Progress bar */}
            {uploading && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>Uploading and processing...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-primary-600 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Results */}
      {result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Import Complete</h2>
                <p className="text-sm text-gray-500">Your contacts have been processed successfully.</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-green-50 p-4 text-center">
                <p className="text-2xl font-bold text-green-700">{result.imported.toLocaleString()}</p>
                <p className="text-sm text-green-600">New Contacts</p>
              </div>
              <div className="rounded-lg bg-blue-50 p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">{result.duplicates.toLocaleString()}</p>
                <p className="text-sm text-blue-600">Updated (Duplicates)</p>
              </div>
              <div className="rounded-lg bg-yellow-50 p-4 text-center">
                <p className="text-2xl font-bold text-yellow-700">{result.skipped.toLocaleString()}</p>
                <p className="text-sm text-yellow-600">Skipped</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-4 text-center">
                <p className="text-2xl font-bold text-gray-700">{result.total.toLocaleString()}</p>
                <p className="text-sm text-gray-600">Total Rows</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-red-600">
                  {result.errors.length} error(s) during import
                </summary>
                <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-red-50 p-3 text-xs text-red-700">
                  {result.errors.map((e, i) => (
                    <li key={i} className="py-0.5">{e}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-6 flex gap-2">
              <button
                onClick={reset}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Import Another File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
