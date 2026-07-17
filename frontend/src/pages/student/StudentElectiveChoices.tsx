import { useState, useEffect, useCallback } from 'react';
import { ListChecks, Clock, CheckCircle2, XCircle, Send, Undo2, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface ElectiveOption {
  subject_id: number;
  subject_name: string;
  subject_code: string;
  department: string;
  status: 'Pending' | 'Approved' | 'Rejected' | null;
  enrollment_id: number | null;
}

interface SubjectPoolGroup {
  pool_type: 'CORE_COMPULSORY' | 'PATHWAY_CORE' | 'GUIDED_ELECTIVE';
  pool_type_label: string;
  min_subjects: number;
  max_subjects: number;
  subjects: ElectiveOption[];
}

const STATUS_STYLE: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Rejected: 'bg-red-50 text-red-700 border-red-200',
};

export default function StudentElectiveChoices() {
  const [electives, setElectives] = useState<ElectiveOption[]>([]);
  const [pools, setPools] = useState<SubjectPoolGroup[] | null>(null);
  const [presetName, setPresetName] = useState<string | null>(null);
  const [gradeName, setGradeName] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [busySubjectId, setBusySubjectId] = useState<number | null>(null);

  const fetchElectives = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/subjects/my-electives/');
      const result = res.data;
      if (result.status === 'success') {
        setElectives(result.data.electives);
        setPools(result.data.pools ?? null);
        setPresetName(result.data.preset_name ?? null);
        setGradeName(result.data.grade_name);
        setAcademicYear(result.data.academic_year);
      } else {
        toast.error(result.message || 'Failed to load elective options.');
      }
    } catch (error: any) {
      console.error('Failed to load elective options', error);
      toast.error(error.response?.data?.message || 'Failed to load elective options.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchElectives();
  }, [fetchElectives]);

  const handleRequest = async (subjectId: number) => {
    setBusySubjectId(subjectId);
    try {
      const res = await api.post('/api/subjects/my-electives/request/', { subject_id: subjectId });
      toast.success(res.data.message);
      fetchElectives();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to submit request.');
    } finally {
      setBusySubjectId(null);
    }
  };

  const handleWithdraw = async (subjectId: number, enrollmentId: number) => {
    setBusySubjectId(subjectId);
    try {
      const res = await api.delete('/api/subjects/my-electives/request/', {
        data: { enrollment_id: enrollmentId },
      });
      toast.success(res.data.message);
      fetchElectives();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to withdraw request.');
    } finally {
      setBusySubjectId(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 rounded-2xl"></div>
        <div className="h-80 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  const renderTable = (options: ElectiveOption[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-100 bg-slate-50">
            <th className="px-6 py-3 font-bold">Subject</th>
            <th className="px-6 py-3 font-bold">Department</th>
            <th className="px-6 py-3 font-bold">Status</th>
            <th className="px-6 py-3 font-bold text-right">Action</th>
          </tr>
        </thead>
        <tbody className="text-sm text-slate-700 divide-y divide-slate-50">
          {options.map((e) => (
            <tr key={e.subject_id} className="hover:bg-slate-50 transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-slate-300 shrink-0" />
                  <span className="font-semibold text-slate-800">{e.subject_name}</span>
                  <span className="text-xs text-slate-400 font-mono">{e.subject_code}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-slate-500">{e.department}</td>
              <td className="px-6 py-4">
                {e.status ? (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${STATUS_STYLE[e.status]}`}>
                    {e.status === 'Pending' && <Clock className="w-3 h-3" />}
                    {e.status === 'Approved' && <CheckCircle2 className="w-3 h-3" />}
                    {e.status === 'Rejected' && <XCircle className="w-3 h-3" />}
                    {e.status}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 italic">Not requested</span>
                )}
              </td>
              <td className="px-6 py-4 text-right">
                {!e.status || e.status === 'Rejected' ? (
                  <button
                    onClick={() => handleRequest(e.subject_id)}
                    disabled={busySubjectId === e.subject_id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg transition-colors border border-indigo-200 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" /> {e.status === 'Rejected' ? 'Request Again' : 'Request'}
                  </button>
                ) : e.status === 'Pending' ? (
                  <button
                    onClick={() => e.enrollment_id && handleWithdraw(e.subject_id, e.enrollment_id)}
                    disabled={busySubjectId === e.subject_id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-lg transition-colors border border-slate-200 disabled:opacity-50"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Withdraw
                  </button>
                ) : (
                  <span className="text-xs text-slate-300 italic">Locked in</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const hasPools = !!pools && pools.length > 0;
  const isEmpty = hasPools ? pools!.every((pool) => pool.subjects.length === 0) : electives.length === 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-indigo-600 bg-indigo-50">
          <ListChecks className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">My Elective Choices</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {gradeName ? `${gradeName} · ` : ''}Request the elective subjects you want to take{academicYear ? ` for ${academicYear}` : ''}. An administrator reviews and approves each request.
            {presetName ? ` Grouped by your curriculum structure: ${presetName}.` : ''}
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div className="text-slate-400 bg-white p-10 rounded-2xl border border-slate-100 text-center text-sm">
          No elective subjects are configured for your grade yet.
        </div>
      ) : hasPools ? (
        <div className="space-y-6">
          {pools!.filter((pool) => pool.subjects.length > 0).map((pool) => {
            const pickedCount = pool.subjects.filter((s) => s.status === 'Pending' || s.status === 'Approved').length;
            return (
              <div key={pool.pool_type} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 bg-slate-50">
                  <h3 className="text-sm font-bold text-slate-800">{pool.pool_type_label}</h3>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${pickedCount < pool.min_subjects || pickedCount > pool.max_subjects ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {pickedCount} of {pool.min_subjects === pool.max_subjects ? pool.max_subjects : `${pool.min_subjects}-${pool.max_subjects}`} selected
                  </span>
                </div>
                {renderTable(pool.subjects)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {renderTable(electives)}
        </div>
      )}
    </div>
  );
}
