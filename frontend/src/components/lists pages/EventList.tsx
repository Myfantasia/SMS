
interface SchoolEvent {
  id: number;
  title: string;
  time: string;
  date: string;
  description: string;
}

interface EventListProps {
  events: SchoolEvent[];
  selectedDate: Date | null;
}

export default function EventList({ events, selectedDate }: EventListProps) {
  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm dark:shadow-none border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          Events for {selectedDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </h1>
        <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold cursor-pointer hover:underline">View All</span>
      </div>

      <div className="flex flex-col gap-4">
        {events.length > 0 ? (
          events.map((event) => (
            <div key={event.id} className="p-4 rounded-xl border-2 border-t-4 border-slate-100 dark:border-slate-700 border-t-blue-500 dark:border-t-blue-400 bg-slate-50 dark:bg-slate-800 transition-colors hover:bg-white dark:hover:bg-slate-700/60">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-700 dark:text-slate-200">{event.title}</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{event.time}</span>
              </div>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{event.description}</p>
            </div>
          ))
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-slate-400 dark:text-slate-500">No events scheduled for this date.</p>
          </div>
        )}
      </div>
    </div>
  );
}