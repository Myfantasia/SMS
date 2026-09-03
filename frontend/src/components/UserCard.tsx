import { MoreHorizontal } from 'lucide-react';

interface UserCardProps {
  type: string;
  count: number | string;
  dateStr?: string;
}

export default function UserCard({ type, count, dateStr = "2026/27" }: UserCardProps) {
  return (
    <div className="rounded-2xl odd:bg-blue-600 even:bg-yellow-400 p-4 flex-1 min-w-32.5 shadow-sm dark:shadow-none transition-transform hover:scale-105 cursor-pointer">
      <div className="flex justify-between items-center text-white">
        <span className="text-[10px] bg-white/30 px-2 py-1 rounded-full text-white backdrop-blur-sm">
          {dateStr}
        </span>
        <MoreHorizontal className="w-5 h-5 text-white cursor-pointer" />
      </div>
      <h1 className="text-2xl font-bold my-4 text-white">{count}</h1>
      <h2 className="capitalize text-sm font-medium text-white/90">{type}</h2>
    </div>
  );
}