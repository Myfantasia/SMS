import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Banknote, Wallet, TrendingUp, Search, Users, GraduationCap } from 'lucide-react';
import api from '../../libs/axiosInstance';

interface StudentFeeRow {
  id: number;
  name: string;
  class_name: string;
  fee: number;
}

interface TeacherSalaryRow {
  id: number;
  name: string;
  subjects: string;
  salary: number;
}

interface FinanceData {
  total_revenue: number;
  total_salary_expense: number;
  net: number;
  students: StudentFeeRow[];
  teachers: TeacherSalaryRow[];
}

export default function FinanceHub() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'fees' | 'salaries'>('fees');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    api.get('/api/finance-overview/')
      .then((res) => {
        if (res.data?.status === 'success') setData(res.data.data);
      })
      .catch((err) => console.error("Failed to fetch finance overview", err))
      .finally(() => setLoading(false));
  }, []);

  const filteredStudents = useMemo(() => {
    if (!data) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return data.students;
    return data.students.filter((s) => s.name.toLowerCase().includes(q) || s.class_name.toLowerCase().includes(q));
  }, [data, searchTerm]);

  const filteredTeachers = useMemo(() => {
    if (!data) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return data.teachers;
    return data.teachers.filter((t) => t.name.toLowerCase().includes(q) || t.subjects.toLowerCase().includes(q));
  }, [data, searchTerm]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 rounded-2xl"></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-slate-200 rounded-2xl"></div>)}
        </div>
        <div className="h-80 bg-slate-200 rounded-2xl"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-slate-400 text-sm">
        Couldn't load finance data. Please refresh the page.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-amber-600 bg-amber-50">
          <CircleDollarSign className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Fees & Salary</h1>
          <p className="text-sm text-slate-500 mt-0.5">A live snapshot of student fees and staff salaries on record.</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
          <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl"><Banknote className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Fee Revenue</span>
            <span className="text-3xl font-extrabold text-slate-800 leading-none">${data.total_revenue.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
          <div className="p-4 bg-red-50 text-red-600 rounded-2xl"><Wallet className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Salary Expense</span>
            <span className="text-3xl font-extrabold text-slate-800 leading-none">${data.total_salary_expense.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
          <div className={`p-4 rounded-2xl ${data.net >= 0 ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}><TrendingUp className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Net</span>
            <span className="text-3xl font-extrabold text-slate-800 leading-none">${data.net.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('fees')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${activeTab === 'fees' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <GraduationCap className="w-4 h-4" /> Student Fees
          </button>
          <button
            onClick={() => setActiveTab('salaries')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${activeTab === 'salaries' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Users className="w-4 h-4" /> Staff Salaries
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-blue-500 transition-all w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder={activeTab === 'fees' ? "Search by student or class..." : "Search by teacher or subject..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'fees' ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-400 uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-5 font-bold">Student</th>
                  <th className="py-3 px-5 font-bold">Class</th>
                  <th className="py-3 px-5 font-bold text-right">Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredStudents.length === 0 ? (
                  <tr><td colSpan={3} className="py-10 text-center text-slate-400 text-sm">No students match your search.</td></tr>
                ) : filteredStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold text-slate-800">{s.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-5 text-slate-500">{s.class_name}</td>
                    <td className="py-3 px-5 text-right font-bold text-slate-700">${s.fee.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-400 uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-5 font-bold">Teacher</th>
                  <th className="py-3 px-5 font-bold">Subjects</th>
                  <th className="py-3 px-5 font-bold text-right">Salary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredTeachers.length === 0 ? (
                  <tr><td colSpan={3} className="py-10 text-center text-slate-400 text-sm">No teachers match your search.</td></tr>
                ) : filteredTeachers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs shrink-0">
                          {t.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold text-slate-800">{t.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-5 text-slate-500">{t.subjects}</td>
                    <td className="py-3 px-5 text-right font-bold text-slate-700">${t.salary.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
