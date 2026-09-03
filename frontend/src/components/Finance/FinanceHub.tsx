import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Banknote, Wallet, TrendingUp, TrendingDown, Search, Users, GraduationCap, PieChart } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTheme } from '@mui/material/styles';
import api from '../../libs/axiosInstance';
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, MOCK_FINANCE_BREAKDOWN } from './financeCategories';

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

type Tab = 'fees' | 'salaries' | 'breakdown';

// Shared bar chart for the Income & Expense breakdown tab -- category on the Y axis,
// amount on the X axis, one themed color per side (emerald for income, red for expense).
function BreakdownChart({ categories, amounts, color }: { categories: typeof INCOME_CATEGORIES; amounts: Record<string, number>; color: string }) {
  const theme = useTheme();
  const chartData = categories.map((c) => ({ name: c.label, amount: amounts[c.key] || 0 }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} horizontal={false} />
        <XAxis type="number" axisLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 11 }} tickLine={false} />
        <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={140} tick={{ fill: theme.palette.text.secondary, fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: theme.palette.action.hover }}
          contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, color: theme.palette.text.primary }}
          formatter={(value) => [`$${Number(value ?? 0).toLocaleString()}`, 'Amount']}
        />
        <Bar dataKey="amount" fill={color} radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function FinanceHub() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('fees');
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

  const mockIncomeTotal = useMemo(
    () => INCOME_CATEGORIES.reduce((sum, c) => sum + (MOCK_FINANCE_BREAKDOWN.income[c.key] || 0), 0), []
  );
  const mockExpenseTotal = useMemo(
    () => EXPENSE_CATEGORIES.reduce((sum, c) => sum + (MOCK_FINANCE_BREAKDOWN.expense[c.key] || 0), 0), []
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-12 w-80 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>)}
        </div>
        <div className="h-80 bg-slate-200 dark:bg-slate-800 rounded-2xl"></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm">
        Couldn't load finance data. Please refresh the page.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10">
          <CircleDollarSign className="w-7 h-7" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">Fees & Salary</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">A live snapshot of student fees and staff salaries on record.</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none flex items-center gap-5">
          <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl"><Banknote className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Fee Revenue</span>
            <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">${data.total_revenue.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none flex items-center gap-5">
          <div className="p-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-2xl"><Wallet className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Salary Expense</span>
            <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">${data.total_salary_expense.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none flex items-center gap-5">
          <div className={`p-4 rounded-2xl ${data.net >= 0 ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}><TrendingUp className="w-7 h-7" strokeWidth={2.5} /></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Net</span>
            <span className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 leading-none">${data.net.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('fees')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${activeTab === 'fees' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <GraduationCap className="w-4 h-4" /> Student Fees
          </button>
          <button
            onClick={() => setActiveTab('salaries')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${activeTab === 'salaries' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <Users className="w-4 h-4" /> Staff Salaries
          </button>
          <button
            onClick={() => setActiveTab('breakdown')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${activeTab === 'breakdown' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <PieChart className="w-4 h-4" /> Income & Expense
          </button>
        </div>

        {activeTab !== 'breakdown' && (
          <div className="flex items-center gap-2 rounded-full ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2 bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-400 transition-all w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
            <input
              type="text"
              placeholder={activeTab === 'fees' ? "Search by student or class..." : "Search by teacher or subject..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>
        )}
      </div>

      {/* Content */}
      {activeTab === 'breakdown' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              A categorized view of where money comes in and goes out. Set up with realistic school line items now, so plugging in a real finance ledger later is a data swap, not a redesign.
            </p>
            <span className="shrink-0 ml-4 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-full">Sample data</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                  <TrendingUp className="w-4 h-4" /> Income Breakdown
                </div>
                <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">${mockIncomeTotal.toLocaleString()}</span>
              </div>
              <BreakdownChart categories={INCOME_CATEGORIES} amounts={MOCK_FINANCE_BREAKDOWN.income} color="#10b981" />
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold text-sm">
                  <TrendingDown className="w-4 h-4" /> Expense Breakdown
                </div>
                <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">${mockExpenseTotal.toLocaleString()}</span>
              </div>
              <BreakdownChart categories={EXPENSE_CATEGORIES} amounts={MOCK_FINANCE_BREAKDOWN.expense} color="#ef4444" />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none overflow-hidden">
          <div className="overflow-x-auto">
            {activeTab === 'fees' ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-5 font-bold">Student</th>
                    <th className="py-3 px-5 font-bold">Class</th>
                    <th className="py-3 px-5 font-bold text-right">Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredStudents.length === 0 ? (
                    <tr><td colSpan={3} className="py-10 text-center text-slate-400 dark:text-slate-500 text-sm">No students match your search.</td></tr>
                  ) : filteredStudents.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{s.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-5 text-slate-500 dark:text-slate-400">{s.class_name}</td>
                      <td className="py-3 px-5 text-right font-bold text-slate-700 dark:text-slate-200">${s.fee.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-5 font-bold">Teacher</th>
                    <th className="py-3 px-5 font-bold">Subjects</th>
                    <th className="py-3 px-5 font-bold text-right">Salary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                  {filteredTeachers.length === 0 ? (
                    <tr><td colSpan={3} className="py-10 text-center text-slate-400 dark:text-slate-500 text-sm">No teachers match your search.</td></tr>
                  ) : filteredTeachers.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 flex items-center justify-center font-bold text-xs shrink-0">
                            {t.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{t.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-5 text-slate-500 dark:text-slate-400">{t.subjects}</td>
                      <td className="py-3 px-5 text-right font-bold text-slate-700 dark:text-slate-200">${t.salary.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
