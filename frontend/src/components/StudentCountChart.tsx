import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';
import { Users } from 'lucide-react';
import { useTheme } from '@mui/material/styles';

export default function StudentCountChart() {
  const theme = useTheme();
  // The hidden background track needs to match the card surface per mode, not stay 'white' --
  // otherwise the unfilled portion of the ring shows as a bright white circle on a dark card.
  const data = [
    { name: 'Total', count: 100, fill: theme.palette.background.paper },
    { name: 'Girls', count: 45, fill: '#fbbf24' }, // Yellow
    { name: 'Boys', count: 55, fill: '#2563eb' },  // Blue
  ];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl w-full h-full p-4 border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none flex flex-col">
      {/* Title */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Students</h1>
        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-full">Sample data</span>
      </div>

      {/* Radial Chart */}
      <div className="relative w-full h-[75%]">
        <ResponsiveContainer>
          <RadialBarChart cx="50%" cy="50%" innerRadius="40%" outerRadius="100%" barSize={32} data={data}>
            <RadialBar background dataKey="count" cornerRadius={10} />
          </RadialBarChart>
        </ResponsiveContainer>
        {/* Center Icon */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Users className="w-10 h-10 text-slate-300 dark:text-slate-600"/>
        </div>
      </div>

      {/* Legend Below */}
      <div className="flex justify-center gap-8 mt-2">
        <div className="flex flex-col gap-1 items-center">
          <div className="w-5 h-5 bg-blue-600 rounded-full" />
          <h1 className="font-bold text-slate-800 dark:text-slate-100">1,234</h1>
          <h2 className="text-xs text-slate-500 dark:text-slate-400">Boys (55%)</h2>
        </div>
        <div className="flex flex-col gap-1 items-center">
          <div className="w-5 h-5 bg-yellow-400 rounded-full" />
          <h1 className="font-bold text-slate-800 dark:text-slate-100">1,011</h1>
          <h2 className="text-xs text-slate-500 dark:text-slate-400">Girls (45%)</h2>
        </div>
      </div>
    </div>
  );
}