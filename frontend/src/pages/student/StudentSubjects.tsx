import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Lock, Clock, CheckCircle2, XCircle, Send, Undo2, X, User, Building2, ListChecks } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../libs/axiosInstance';

interface CompulsorySubject {
  subject_id: number;
  subject_name: string;
  subject_code: string;
  department_name: string | null;
  status: 'Pending' | 'Approved' | 'Rejected' | null;
  teacher_name: string | null;
}

interface ElectiveOption {
  subject_id: number;
  subject_name: string;
  subject_code: string;
  department_name: string | null;
  status: 'Pending' | 'Approved' | 'Rejected' | null;
  enrollment_id: number | null;
}

interface SubjectPoolGroup {
  pool_type: string;
  pool_type_label: string;
  min_subjects: number;
  max_subjects: number;
  subjects: ElectiveOption[];
}

interface DetailSubject {
  subject_name: string;
  subject_code: string;
  department_name: string | null;
  status: string | null;
  teacher_name?: string | null;
  kind: 'Compulsory' | 'Elective';
}

const STATUS_STYLE: Record<string, string> = {
  Pending: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/40',
  Approved: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40',
  Rejected: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/40',
};

export default function StudentSubjects() {
  const [compulsory, setCompulsory] = useState<CompulsorySubject[]>([]);
  const [electives, setElectives] = useState<ElectiveOption[]>([]);
  const [pools, setPools] = useState<SubjectPoolGroup[] | null>(null);
  const [gradeName, setGradeName] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [busySubjectId, setBusySubjectId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailSubject | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, electivesRes] = await Promise.all([
        api.get('/api/subjects/my-subjects/'),
        api.get('/api/subjects/my-electives/'),
      ]);
      const overview = overviewRes.data;
      const elec = electivesRes.data;
      if (overview.status === 'success') {
        setCompulsory(overview.data.compulsory);
        setGradeName(overview.data.grade_name);
        setAcademicYear(overview.data.academic_year);
      }
      if (elec.status === 'success') {
        setElectives(elec.data.electives ?? []);
        setPools(elec.data.pools ?? null);
      }
    } catch (error: any) {
      console.error('Failed to load subjects', error);
      toast.error(error.response?.data?.message || 'Failed to load your subjects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleRequest = async (subjectId: number) => {
    setBusySubjectId(subjectId);
    try {
      const res = await api.post('/api/subjects/my-electives/request/', { subject_id: subjectId });
      toast.success(res.data.message);
      fetchAll();
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
      fetchAll();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to withdraw request.');
    } finally {
      setBusySubjectId(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  const hasPools = !!pools && pools.length > 0;
  const electivesEmpty = hasPools ? pools!.every((pool) => pool.subjects.length === 0) : electives.length === 0;
  const nothingAtAll = compulsory.length === 0 && electivesEmpty;

  const renderElectiveRow = (e: ElectiveOption) => (
    <tr key={e.subject_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer" onClick={() => setDetail({
      subject_name: e.subject_name, subject_code: e.subject_code, department_name: e.department_name,
      status: e.status, kind: 'Elective',
    })}>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
          <span className="font-semibold text-slate-800 dark:text-slate-100">{e.subject_name}</span>
          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{e.subject_code}</span>
        </div>
      </td>
      <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{e.department_name ?? 'Uncategorized'}</td>
      <td className="px-6 py-4">
        {e.status ? (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${STATUS_STYLE[e.status]}`}>
            {e.status === 'Pending' && <Clock className="w-3 h-3" />}
            {e.status === 'Approved' && <CheckCircle2 className="w-3 h-3" />}
            {e.status === 'Rejected' && <XCircle className="w-3 h-3" />}
            {e.status}
          </span>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">Not requested</span>
        )}
      </td>
      <td className="px-6 py-4 text-right" onClick={(evt) => evt.stopPropagation()}>
        {!e.status || e.status === 'Rejected' ? (
          <button
            onClick={() => handleRequest(e.subject_id)}
            disabled={busySubjectId === e.subject_id}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-bold rounded-lg transition-colors border border-indigo-200 dark:border-indigo-500/40 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> {e.status === 'Rejected' ? 'Request Again' : 'Request'}
          </button>
        ) : e.status === 'Pending' ? (
          <button
            onClick={() => e.enrollment_id && handleWithdraw(e.subject_id, e.enrollment_id)}
            disabled={busySubjectId === e.subject_id}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors border border-slate-200 dark:border-slate-600 disabled:opacity-50"
          >
            <Undo2 className="w-3.5 h-3.5" /> Withdraw
          </button>
        ) : (
          <span className="text-xs text-slate-300 dark:text-slate-600 italic">Locked in</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10">
          <BookOpen className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">My Subjects</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {gradeName ? `${gradeName} · ` : ''}Your compulsory and elective subjects{academicYear ? ` for ${academicYear}` : ''}. Click any subject for more detail.
          </p>
        </div>
      </div>

      {nothingAtAll ? (
        <div className="text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 p-10 rounded-2xl border border-slate-100 dark:border-slate-700 text-center text-sm">
          No subjects are configured for your grade yet.
        </div>
      ) : (
        <div className="space-y-6">
          {compulsory.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
              <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Compulsory Subjects</h3>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700">
                  {compulsory.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-slate-400 dark:text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                      <th className="px-6 py-3 font-bold">Subject</th>
                      <th className="px-6 py-3 font-bold">Department</th>
                      <th className="px-6 py-3 font-bold">Teacher</th>
                      <th className="px-6 py-3 font-bold text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm text-slate-700 dark:text-slate-200 divide-y divide-slate-50 dark:divide-slate-800">
                    {compulsory.map((s) => (
                      <tr
                        key={s.subject_id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                        onClick={() => setDetail({
                          subject_name: s.subject_name, subject_code: s.subject_code, department_name: s.department_name,
                          status: s.status, teacher_name: s.teacher_name, kind: 'Compulsory',
                        })}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Lock className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{s.subject_name}</span>
                            <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{s.subject_code}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{s.department_name ?? 'Uncategorized'}</td>
                        <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{s.teacher_name ?? <span className="italic text-slate-300 dark:text-slate-600">Not assigned</span>}</td>
                        <td className="px-6 py-4 text-right">
                          {s.status === 'Approved' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40">
                              <CheckCircle2 className="w-3 h-3" /> Locked
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500 italic">Pending assignment</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!electivesEmpty && (
            hasPools ? (
              <div className="space-y-6">
                {pools!.filter((pool) => pool.subjects.length > 0).map((pool) => {
                  const pickedCount = pool.subjects.filter((s) => s.status === 'Pending' || s.status === 'Approved').length;
                  return (
                    <div key={pool.pool_type} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
                      <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                          <ListChecks className="w-4 h-4 text-indigo-400 dark:text-indigo-400" /> {pool.pool_type_label}
                        </h3>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${pickedCount < pool.min_subjects || pickedCount > pool.max_subjects ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/40' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'}`}>
                          {pickedCount} of {pool.min_subjects === pool.max_subjects ? pool.max_subjects : `${pool.min_subjects}-${pool.max_subjects}`} selected
                        </span>
                      </div>
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="text-slate-400 dark:text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-100 dark:border-slate-700">
                            <th className="px-6 py-3 font-bold">Subject</th>
                            <th className="px-6 py-3 font-bold">Department</th>
                            <th className="px-6 py-3 font-bold">Status</th>
                            <th className="px-6 py-3 font-bold text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm text-slate-700 dark:text-slate-200 divide-y divide-slate-50 dark:divide-slate-800">
                          {pool.subjects.map(renderElectiveRow)}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <ListChecks className="w-4 h-4 text-indigo-400 dark:text-indigo-400" /> Elective Subjects
                  </h3>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-slate-400 dark:text-slate-500 text-[11px] uppercase tracking-wider border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                      <th className="px-6 py-3 font-bold">Subject</th>
                      <th className="px-6 py-3 font-bold">Department</th>
                      <th className="px-6 py-3 font-bold">Status</th>
                      <th className="px-6 py-3 font-bold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm text-slate-700 dark:text-slate-200 divide-y divide-slate-50 dark:divide-slate-800">
                    {electives.map(renderElectiveRow)}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setDetail(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl dark:shadow-none w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-start bg-slate-50 dark:bg-slate-800">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{detail.subject_name}</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5">{detail.subject_code}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${detail.kind === 'Compulsory' ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' : 'bg-indigo-100 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400'}`}>
                  {detail.kind}
                </span>
                {detail.status && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${STATUS_STYLE[detail.status]}`}>
                    {detail.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                <Building2 className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                <span>{detail.department_name ?? 'Uncategorized department'}</span>
              </div>
              {detail.kind === 'Compulsory' && (
                <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <User className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                  <span>{detail.teacher_name ?? 'No teacher assigned yet'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
