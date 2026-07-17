
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
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-slate-800">
          Events for {selectedDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </h1>
        <span className="text-xs text-blue-600 font-semibold cursor-pointer hover:underline">View All</span>
      </div>
      
      <div className="flex flex-col gap-4">
        {events.length > 0 ? (
          events.map((event) => (
            <div key={event.id} className="p-4 rounded-xl border-2 border-t-4 border-slate-100 border-t-blue-500 bg-slate-50 transition-colors hover:bg-white">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-700">{event.title}</h2>
                <span className="text-xs text-slate-500 font-medium">{event.time}</span>
              </div>
              <p className="mt-2 text-sm text-slate-500">{event.description}</p>
            </div>
          ))
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-slate-400">No events scheduled for this date.</p>
          </div>
        )}
      </div>
    </div>
  );
}