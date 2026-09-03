import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { CalendarDays } from 'lucide-react';

type ValuePiece = Date | null;
type Value = ValuePiece | [ValuePiece, ValuePiece];

interface EventCalendarProps {
  selectedDate: Value;
  onDateChange: (date: Value) => void;
  /** Dates (YYYY-MM-DD, local) that have at least one active event, for the dot indicator. */
  eventDates?: Set<string>;
}

function toDateKey(date: Date): string {
  // Local-date key (not toISOString, which shifts by timezone offset) so it matches
  // the local calendar day the dot is rendered under.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function EventCalendar({ selectedDate, onDateChange, eventDates }: EventCalendarProps) {
  return (
    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm dark:shadow-none border border-slate-100 dark:border-slate-700">
      <div className="flex items-center justify-between mb-1 px-1">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <CalendarDays className="w-4 h-4 text-blue-500 dark:text-blue-400" />
          <span className="text-sm font-bold">Calendar</span>
        </div>
        <button
          type="button"
          onClick={() => onDateChange(new Date())}
          className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          Today
        </button>
      </div>
      <style>
        {`
          .react-calendar {
            width: 100% !important;
            max-width: 100% !important;
            background: transparent !important;
            border: none !important;
            font-family: inherit !important;
          }
          .react-calendar__navigation button {
            min-width: 44px;
            background: none;
            font-size: 16px;
            font-weight: bold;
            color: #334155;
            border-radius: 8px;
            transition: background-color 0.15s ease;
          }
          .react-calendar__navigation button:enabled:hover,
          .react-calendar__navigation button:enabled:focus {
            background-color: #F1F5F9;
          }
          [data-dashboard-theme="dark"] .react-calendar__navigation button {
            color: #F1F5F9;
          }
          [data-dashboard-theme="dark"] .react-calendar__navigation button:enabled:hover,
          [data-dashboard-theme="dark"] .react-calendar__navigation button:enabled:focus {
            background-color: #1E293B;
          }
          .react-calendar__tile {
            padding: 1em 0.5em !important;
            aspect-ratio: 1 / 1;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 3px;
            border-radius: 8px;
          }
          [data-dashboard-theme="dark"] .react-calendar__month-view__days__day,
          [data-dashboard-theme="dark"] .react-calendar__navigation__label {
            color: #CBD5E1;
          }
          [data-dashboard-theme="dark"] .react-calendar__month-view__days__day--neighboringMonth {
            color: #475569;
          }
          .react-calendar__tile--now {
            background: #EFF6FF !important;
            box-shadow: inset 0 0 0 1.5px #93C5FD;
            font-weight: 700;
            color: #1D4ED8 !important;
          }
          [data-dashboard-theme="dark"] .react-calendar__tile--now {
            background: rgba(59, 130, 246, 0.12) !important;
            box-shadow: inset 0 0 0 1.5px rgba(96, 165, 250, 0.5);
            color: #93C5FD !important;
          }
          .react-calendar__tile--active {
            background: #2563eb !important;
            color: white !important;
            box-shadow: none;
          }
          [data-dashboard-theme="dark"] .react-calendar__tile--active {
            background: #3B82F6 !important;
          }
          .react-calendar__tile:enabled:hover:not(.react-calendar__tile--active) {
            background-color: #F1F5F9;
          }
          [data-dashboard-theme="dark"] .react-calendar__tile:enabled:hover:not(.react-calendar__tile--active) {
            background-color: #1E293B;
          }
          .event-dot {
            width: 4px;
            height: 4px;
            border-radius: 999px;
            background: #F59E0B;
          }
          .react-calendar__tile--active .event-dot {
            background: white;
          }
          abbr[title] {
            text-decoration: none;
          }
        `}
      </style>
      <Calendar
        onChange={onDateChange}
        value={selectedDate}
        className="w-full border-none font-sans"
        tileContent={({ date, view }) =>
          view === 'month' && eventDates?.has(toDateKey(date)) ? <span className="event-dot" /> : null
        }
      />
    </div>
  );
}