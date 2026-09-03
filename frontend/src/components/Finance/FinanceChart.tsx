import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '@mui/material/styles';
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, MOCK_FINANCE_BREAKDOWN } from './financeCategories';

interface FinanceData {
  name: string;
  income: number;
  expense: number;
}

interface Props {
  data: FinanceData[];
}

type Tab = 'income' | 'expense';

export default function FinanceChart({ data }: Props) {
  // Recharts takes colors as JS props, not CSS classes -- reads off the ambient adminTheme
  // (ThemeProvider in DashboardLayouts.tsx) so the grid/axis actually re-color with the toggle
  // instead of staying light-only regardless of mode.
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('income');

  const categories = tab === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const amounts = MOCK_FINANCE_BREAKDOWN[tab];
  const total = useMemo(() => categories.reduce((sum, c) => sum + (amounts[c.key] || 0), 0), [categories, amounts]);
  const maxAmount = useMemo(() => Math.max(...categories.map((c) => amounts[c.key] || 0)), [categories, amounts]);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl w-full h-full p-4 border border-slate-100 dark:border-slate-700 shadow-sm dark:shadow-none mt-4 flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-lg font-bold text-slate-700 dark:text-slate-100">Finance (Income vs Expense)</h1>
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-full">Sample data</span>
      </div>
      <div className="h-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} vertical={false} />
            <XAxis dataKey="name" axisLine={false} tick={{ fill: theme.palette.text.secondary }} tickLine={false} tickMargin={10} />
            <YAxis axisLine={false} tick={{ fill: theme.palette.text.secondary }} tickLine={false} tickMargin={10} />
            <Tooltip
              cursor={{ fill: theme.palette.action.hover }}
              contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, color: theme.palette.text.primary }}
            />
            <Legend align="center" verticalAlign="top" wrapperStyle={{ paddingBottom: '10px', color: theme.palette.text.secondary }} />
            <Bar dataKey="income" fill="#10b981" name="Income ($)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" fill="#ef4444" name="Expense ($)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Categorized breakdown -- mock now, but the schema (financeCategories.ts) is the
          same shape a real ledger endpoint would return, so wiring real data later is a
          fetch swap, not a UI rewrite. */}
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-0.5 rounded-full ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50 dark:bg-slate-800 p-1">
            <button
              type="button"
              onClick={() => setTab('income')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                tab === 'income'
                  ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm ring-1 ring-slate-200 dark:ring-slate-600'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              Income
            </button>
            <button
              type="button"
              onClick={() => setTab('expense')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                tab === 'expense'
                  ? 'bg-white dark:bg-slate-700 text-red-600 dark:text-red-400 shadow-sm ring-1 ring-slate-200 dark:ring-slate-600'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              Expense
            </button>
          </div>
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
            Total: <span className={tab === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>${total.toLocaleString()}</span>
          </span>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto pr-1">
          {categories.map((cat) => {
            const amount = amounts[cat.key] || 0;
            const pct = maxAmount > 0 ? Math.round((amount / maxAmount) * 100) : 0;
            return (
              <div key={cat.key} className="flex items-center gap-3">
                <div className={`shrink-0 p-1.5 rounded-lg ${cat.chip}`}>{cat.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">{cat.label}</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0">${amount.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${cat.bar}`} style={{ width: `${pct}%` }}></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
