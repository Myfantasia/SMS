import { useState, useEffect, useCallback } from 'react';
import { GitBranch, Clock, CheckCircle2, XCircle, Send, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface ComboSubject {
  id: number;
  name: string;
  code: string;
}

interface ComboOption {
  id: number;
  name: string;
  code: string;
  subjects: ComboSubject[];
}

interface TrackOption {
  id: number;
  name: string;
  description: string;
  preset_combinations: ComboOption[];
}

interface PathwayOption {
  id: number;
  name: string;
  description: string;
  tracks: TrackOption[];
}

interface Selection {
  selection_id: number;
  pathway_id: number;
  pathway_name: string;
  track_id: number | null;
  track_name: string | null;
  preset_combination_id: number | null;
  preset_combination_name: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
}

const STATUS_STYLE: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Rejected: 'bg-red-50 text-red-700 border-red-200',
};

export default function StudentPathwayChoice() {
  const [pathways, setPathways] = useState<PathwayOption[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [gradeName, setGradeName] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [trackChoice, setTrackChoice] = useState<Record<number, number | ''>>({});
  const [comboChoice, setComboChoice] = useState<Record<number, number | ''>>({});

  const fetchPathways = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/subjects/my-pathway/');
      const result = res.data;
      if (result.status === 'success') {
        setPathways(result.data.pathways);
        setSelection(result.data.selection);
        setGradeName(result.data.grade_name);
        setAcademicYear(result.data.academic_year);
      } else {
        toast.error(result.message || 'Failed to load pathway options.');
      }
    } catch (error: any) {
      console.error('Failed to load pathway options', error);
      toast.error(error.response?.data?.message || 'Failed to load pathway options.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPathways();
  }, [fetchPathways]);

  const handleRequest = async (pathway: PathwayOption) => {
    const trackId = trackChoice[pathway.id];
    if (pathway.tracks.length > 0 && !trackId) {
      toast.error(`Choose a track for ${pathway.name} first.`);
      return;
    }
    const track = pathway.tracks.find((t) => t.id === trackId);
    const comboId = trackId ? comboChoice[trackId as number] : '';
    if (track && track.preset_combinations.length > 0 && !comboId) {
      toast.error(`Choose one of the approved subject combinations for ${track.name} first.`);
      return;
    }
    setBusyId(pathway.id);
    try {
      const res = await api.post('/api/subjects/my-pathway/request/', {
        pathway_id: pathway.id,
        ...(trackId ? { track_id: trackId } : {}),
        ...(comboId ? { preset_combination_id: comboId } : {}),
      });
      toast.success(res.data.message);
      fetchPathways();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to submit request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleWithdraw = async () => {
    if (!selection) return;
    setBusyId(selection.pathway_id);
    try {
      const res = await api.delete('/api/subjects/my-pathway/request/', {
        data: { selection_id: selection.selection_id },
      });
      toast.success(res.data.message);
      fetchPathways();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to withdraw request.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 rounded-2xl"></div>
        <div className="h-64 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  const isLocked = selection?.status === 'Approved';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50">
          <GitBranch className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">My Pathway</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {gradeName ? `${gradeName} · ` : ''}Choose your Senior Secondary specialization{academicYear ? ` for ${academicYear}` : ''}. An administrator or your Class Teacher reviews and approves it.
          </p>
        </div>
      </div>

      {pathways.length === 0 ? (
        <div className="text-slate-400 bg-white p-10 rounded-2xl border border-slate-100 text-center text-sm">
          No pathways are configured for your curriculum yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pathways.map((p) => {
            const isMine = selection?.pathway_id === p.id;
            const busy = busyId === p.id;
            return (
              <div
                key={p.id}
                className={`bg-white rounded-2xl shadow-sm border p-5 space-y-3 transition-colors ${
                  isMine ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-slate-800">{p.name}</h3>
                    {p.description && <p className="text-xs text-slate-500 mt-1">{p.description}</p>}
                  </div>
                  {isMine && (
                    <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${STATUS_STYLE[selection!.status]}`}>
                      {selection!.status === 'Pending' && <Clock className="w-3 h-3" />}
                      {selection!.status === 'Approved' && <CheckCircle2 className="w-3 h-3" />}
                      {selection!.status === 'Rejected' && <XCircle className="w-3 h-3" />}
                      {selection!.status}
                    </span>
                  )}
                </div>

                {isMine && selection!.track_name && (
                  <p className="text-xs text-slate-500 -mt-2">Track: <span className="font-semibold text-slate-700">{selection!.track_name}</span></p>
                )}
                {isMine && selection!.preset_combination_name && (
                  <p className="text-xs text-slate-500 -mt-2">Combination: <span className="font-semibold text-slate-700">{selection!.preset_combination_name}</span></p>
                )}

                {!isMine && p.tracks.length > 0 && !isLocked && (
                  <select
                    aria-label={`Track for ${p.name}`}
                    value={trackChoice[p.id] ?? ''}
                    onChange={(e) => setTrackChoice((prev) => ({ ...prev, [p.id]: e.target.value ? Number(e.target.value) : '' }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">Select a track...</option>
                    {p.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}

                {!isMine && !isLocked && (() => {
                  const trackId = trackChoice[p.id];
                  const track = p.tracks.find((t) => t.id === trackId);
                  if (!track || track.preset_combinations.length === 0) return null;
                  return (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Choose an approved combination</p>
                      <select
                        aria-label={`Subject combination for ${track.name}`}
                        value={comboChoice[track.id] ?? ''}
                        onChange={(e) => setComboChoice((prev) => ({ ...prev, [track.id]: e.target.value ? Number(e.target.value) : '' }))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">Select a combination...</option>
                        {track.preset_combinations.map((c) => (
                          <option key={c.id} value={c.id}>{c.subjects.map((s) => s.name).join(' + ')}</option>
                        ))}
                      </select>
                    </div>
                  );
                })()}

                <div className="pt-1">
                  {isMine && selection!.status === 'Approved' ? (
                    <span className="text-xs text-slate-300 italic">Locked in</span>
                  ) : isMine && selection!.status === 'Pending' ? (
                    <button
                      onClick={handleWithdraw}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-lg transition-colors border border-slate-200 disabled:opacity-50"
                    >
                      <Undo2 className="w-3.5 h-3.5" /> Withdraw
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRequest(p)}
                      disabled={busy || isLocked}
                      title={isLocked ? 'Your pathway is already approved and locked.' : undefined}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg transition-colors border border-indigo-200 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" /> {isMine && selection?.status === 'Rejected' ? 'Request Again' : 'Request'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
