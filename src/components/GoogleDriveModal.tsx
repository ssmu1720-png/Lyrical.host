import React, { useState, useEffect } from 'react';
import {
  Cloud as FolderCloud,
  Search,
  Download,
  Trash2,
  RefreshCw,
  AlertTriangle,
  FileCode,
  CheckCircle2,
} from 'lucide-react';
import {
  DriveFileItem,
  listGoogleDriveFiles,
  downloadGoogleDriveFileText,
  deleteGoogleDriveFile,
  googleSignIn,
  getAccessToken,
} from '../lib/workspaceAuth';

interface GoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFileContent?: (fileName: string, content: string) => void;
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  isOpen,
  onClose,
  onSelectFileContent,
}) => {
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<DriveFileItem | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const loadFiles = async (q = search) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        setLoading(false);
        return;
      }
      const list = await listGoogleDriveFiles(q);
      setFiles(list);
      setNeedsAuth(false);
    } catch (err: any) {
      if (err.message === 'NEEDS_GOOGLE_AUTH') {
        setNeedsAuth(true);
      } else {
        setError(err.message || 'Could not load Google Drive files.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadFiles('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnectDrive = async () => {
    setError(null);
    try {
      await googleSignIn();
      setNeedsAuth(false);
      await loadFiles(search);
    } catch {
      setError('Google Drive sign-in was cancelled or failed.');
    }
  };

  const handleImportFile = async (file: DriveFileItem) => {
    if (!onSelectFileContent) return;
    setImportingId(file.id);
    setError(null);
    try {
      const content = await downloadGoogleDriveFileText(file.id);
      onSelectFileContent(file.name, content);
      setNotice(`Imported "${file.name}" into bot workspace.`);
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err: any) {
      setError(err.message || 'Failed to read file content from Google Drive.');
    } finally {
      setImportingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!fileToDelete) return;
    const target = fileToDelete;
    setFileToDelete(null);
    try {
      await deleteGoogleDriveFile(target.id);
      setFiles((prev) => prev.filter((f) => f.id !== target.id));
      setNotice(`Deleted "${target.name}" from Google Drive.`);
    } catch (err: any) {
      setError(err.message || 'Failed to delete file from Google Drive.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <FolderCloud className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-semibold text-white">Google Drive Bot File Manager</h2>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg border border-slate-800"
          >
            Close
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200">
              {error}
            </div>
          )}
          {notice && (
            <div className="p-3 rounded-lg bg-cyan-950/50 border border-cyan-500/40 text-xs text-cyan-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
              {notice}
            </div>
          )}

          {needsAuth ? (
            <div className="py-10 text-center space-y-4">
              <p className="text-sm text-slate-300 max-w-md mx-auto">
                Connect your Google account to browse, import, or manage WhatsApp bot source files and backups stored in your Google Drive.
              </p>
              <div className="max-w-xs mx-auto">
                <button type="button" onClick={handleConnectDrive} className="gsi-material-button">
                  <div className="gsi-material-button-state"></div>
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        <path fill="none" d="M0 0h48v48H0z"></path>
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">Sign in with Google</span>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadFiles(search)}
                    placeholder="Search files in Google Drive (e.g., index.js, .env, config.json)..."
                    className="w-full pl-9 pr-4 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => loadFiles(search)}
                  className="px-3 py-2 text-xs font-medium bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {loading ? (
                <div className="py-12 text-center text-xs text-slate-400">Loading files from Google Drive...</div>
              ) : files.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No matching files found in your Google Drive.
                </div>
              ) : (
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between px-4 py-3 bg-slate-950/60 hover:bg-slate-900/80 transition-colors gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-200 truncate">{file.name}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-2">
                            <span>{file.mimeType}</span>
                            {file.modifiedTime && (
                              <>
                                <span>·</span>
                                <span>{new Date(file.modifiedTime).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {onSelectFileContent && (
                          <button
                            type="button"
                            onClick={() => handleImportFile(file)}
                            disabled={importingId === file.id}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25 flex items-center gap-1 whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {importingId === file.id ? 'Importing...' : 'Import to Bot'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setFileToDelete(file)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg border border-slate-800 hover:border-rose-500/40"
                          title="Delete file from Google Drive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mandatory Confirmation Dialog for Deleting a Google Drive File */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-semibold text-white">Delete File from Google Drive?</h3>
            </div>
            <p className="text-sm text-slate-300">
              Are you sure you want to permanently delete <strong>"{fileToDelete.name}"</strong> from your Google Drive? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFileToDelete(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-500"
              >
                Delete from Google Drive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
