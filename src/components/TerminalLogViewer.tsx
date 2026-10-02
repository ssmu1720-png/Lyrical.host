import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal as TerminalIcon,
  Pause,
  Play,
  Trash2,
  Download,
  Search,
  Send,
  CloudUpload,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { apiRequest, getStoredSessionToken } from '../lib/api';
import { saveFileToGoogleDrive, googleSignIn } from '../lib/workspaceAuth';

interface TerminalLogViewerProps {
  botId: string;
  botName: string;
  isRunning?: boolean;
  fullHeight?: boolean;
}

export const TerminalLogViewer: React.FC<TerminalLogViewerProps> = ({
  botId,
  botName,
  isRunning = false,
  fullHeight = false,
}) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getStoredSessionToken();
    if (!token) return;

    const es = new EventSource(`/api/bots/${botId}/logs/stream?token=${encodeURIComponent(token)}`);
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.line) {
          setLogs((prev) => {
            const next = [...prev, parsed.line];
            return next.length > 1200 ? next.slice(-1200) : next;
          });
        }
      } catch {
        // ignore malformed frame
      }
    };

    return () => {
      es.close();
    };
  }, [botId]);

  useEffect(() => {
    if (!paused && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs, paused]);

  const handleSendCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    const cmd = commandInput.trim();
    setCommandInput('');
    try {
      await apiRequest(`/api/bots/${botId}/terminal`, {
        method: 'POST',
        body: JSON.stringify({ input: cmd }),
      });
    } catch (err: any) {
      setStatusNotice(err.message || 'Could not send command to bot stdin.');
    }
  };

  const handleClearLogs = async () => {
    setConfirmClearOpen(false);
    try {
      await apiRequest(`/api/bots/${botId}/logs`, { method: 'DELETE' });
      setLogs([]);
    } catch (err: any) {
      setStatusNotice(err.message);
    }
  };

  const handleDownloadLogs = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${botName.toLowerCase().replace(/\s+/g, '-')}-logs-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBackupToDrive = async () => {
    setSavingToDrive(true);
    setStatusNotice(null);
    try {
      const filename = `LYRICAL_${botName.replace(/\s+/g, '_')}_logs_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
      await saveFileToGoogleDrive(filename, logs.join('\n') || 'No logs recorded.');
      setStatusNotice(`Saved "${filename}" to your Google Drive.`);
    } catch (err: any) {
      if (err.message === 'NEEDS_GOOGLE_AUTH') {
        try {
          await googleSignIn();
          const filename = `LYRICAL_${botName.replace(/\s+/g, '_')}_logs.log`;
          await saveFileToGoogleDrive(filename, logs.join('\n') || 'No logs recorded.');
          setStatusNotice(`Saved "${filename}" to your Google Drive.`);
        } catch {
          setStatusNotice('Google Drive authorization is required to export logs.');
        }
      } else {
        setStatusNotice(err.message || 'Failed to save logs to Google Drive.');
      }
    } finally {
      setSavingToDrive(false);
    }
  };

  const filteredLogs = search.trim()
    ? logs.filter((l) => l.toLowerCase().includes(search.trim().toLowerCase()))
    : logs;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden flex flex-col">
      {/* Terminal Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-800/80 bg-slate-900/70">
        <div className="flex items-center gap-2.5">
          <TerminalIcon className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono font-semibold text-slate-200">
            {botName} · Live Process Stream
          </span>
          <span className="text-xs text-slate-500">·</span>
          <span className="text-xs font-mono text-slate-400 tabular-nums">{logs.length} lines</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter output..."
              className="pl-8 pr-3 py-1 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-36 sm:w-48"
            />
          </div>

          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              paused
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
            }`}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? 'Resume Scroll' : 'Pause Scroll'}
          </button>

          <button
            type="button"
            onClick={handleDownloadLogs}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>

          <button
            type="button"
            onClick={handleBackupToDrive}
            disabled={savingToDrive}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <CloudUpload className="w-3.5 h-3.5" />
            {savingToDrive ? 'Saving...' : 'Backup to Drive'}
          </button>

          <button
            type="button"
            onClick={() => setConfirmClearOpen(true)}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 text-rose-400 hover:border-rose-500/40 transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="px-4 py-2 bg-cyan-950/50 border-b border-cyan-500/30 text-xs text-cyan-200 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            {statusNotice}
          </span>
          <button onClick={() => setStatusNotice(null)} className="text-cyan-400 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Log Output Viewport */}
      <div
        ref={scrollContainerRef}
        className={`p-4 font-mono text-xs leading-relaxed overflow-y-auto space-y-1 select-text ${
          fullHeight ? 'h-[62vh]' : 'h-80 sm:h-96'
        }`}
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
            <p>No process output lines matching current view.</p>
            <p className="text-[11px] text-slate-600 mt-1">
              Real stdout and stderr streams appear here immediately when the bot runs.
            </p>
          </div>
        ) : (
          filteredLogs.map((line, i) => {
            const isErr =
              line.includes('[ERR]') ||
              line.toLowerCase().includes('error') ||
              line.toLowerCase().includes('failed') ||
              line.toLowerCase().includes('exception');
            const isHighlight =
              line.includes('PAIRING CODE') ||
              line.includes('QR_CODE_DATA') ||
              line.includes('COMPLETED SUCCESSFULLY') ||
              line.includes('WhatsApp Connected');

            return (
              <div
                key={i}
                className={`break-all py-0.5 px-2 rounded ${
                  isErr
                    ? 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500'
                    : isHighlight
                    ? 'bg-cyan-950/40 text-cyan-300 border-l-2 border-cyan-400 font-medium'
                    : 'text-slate-300 hover:bg-slate-900/60'
                }`}
              >
                {line}
              </div>
            );
          })
        )}
      </div>

      {/* Interactive Stdin Command Bar */}
      <form
        onSubmit={handleSendCommand}
        className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-800 bg-slate-900/90"
      >
        <span className="text-xs font-mono text-cyan-400 select-none">$</span>
        <input
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          disabled={!isRunning}
          placeholder={
            isRunning
              ? 'Send stdin command to running bot (try: status, pair, qr, connect)...'
              : 'Start the bot process to send interactive stdin commands'
          }
          className="flex-1 bg-transparent text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!isRunning || !commandInput.trim()}
          className="px-3 py-1 text-xs font-medium bg-cyan-500 text-slate-950 rounded-lg hover:bg-cyan-400 transition-colors disabled:opacity-40 flex items-center gap-1 whitespace-nowrap"
        >
          <Send className="w-3 h-3" />
          Execute
        </button>
      </form>

      {/* Confirmation Modal for Clearing Logs */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-semibold text-white">Clear Bot Process Logs?</h3>
            </div>
            <p className="text-sm text-slate-300">
              This will permanently clear the persisted log output file for <strong>{botName}</strong>. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearLogs}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-500"
              >
                Confirm Clear Logs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
