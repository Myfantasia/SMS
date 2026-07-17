import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface FinanceData {
  name: string;
  income: number;
  expense: number;
}

interface Props {
  data: FinanceData[];
}

export default function FinanceChart({ data }: Props) {
  return (
    <div className="bg-white rounded-xl w-full h-full p-4 border border-slate-100 shadow-sm mt-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-slate-700">Finance (Income vs Expense)</h1>
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 px-2 py-1 rounded-full">Sample data</span>
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <LineChart width={500} height={300} data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" axisLine={false} tick={{fill:"#94a3b8"}} tickLine={false} tickMargin={10} />
          <YAxis axisLine={false} tick={{fill:"#94a3b8"}} tickLine={false} tickMargin={20} />
          <Tooltip />
          <Legend align="center" verticalAlign="top" wrapperStyle={{paddingTop:"10px", paddingBottom:"30px"}} />
          <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={4} dot={{r:4}} activeDot={{r:8}} name="Income ($)" />
          <Line type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={4} dot={{r:4}} name="Expense ($)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}