import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AttendanceData {
  name: string;
  present: number;
  absent: number;
}

interface Props {
  data: AttendanceData[];
}

export default function AttendanceChart({ data }: Props) {
  return (
    <div className="bg-white rounded-xl w-full h-full p-4 border border-slate-100 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-slate-700">Attendance Overview</h1>
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <BarChart width={500} height={300} data={data} barSize={20}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ddd" />
          <XAxis dataKey="name" axisLine={false} tick={{fill:"#94a3b8"}} tickLine={false} />
          <YAxis axisLine={false} tick={{fill:"#94a3b8"}} tickLine={false} />
          <Tooltip contentStyle={{borderRadius:"10px", borderColor:"#e2e8f0"}} />
          <Legend align="left" verticalAlign="top" wrapperStyle={{paddingTop:"20px", paddingBottom:"40px"}} />
          <Bar dataKey="present" fill="#2563eb" legendType="circle" radius={[10,10,0,0]} name="Present" />
          <Bar dataKey="absent" fill="#fbbf24" legendType="circle" radius={[10,10,0,0]} name="Absent" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}