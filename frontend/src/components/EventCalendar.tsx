import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css'; 

type ValuePiece = Date | null;
type Value = ValuePiece | [ValuePiece, ValuePiece];

interface EventCalendarProps {
  selectedDate: Value;
  onDateChange: (date: Value) => void;
}

export default function EventCalendar({ selectedDate, onDateChange }: EventCalendarProps) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
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
          }
          .react-calendar__tile {
            padding: 1em 0.5em !important;
            aspect-ratio: 1 / 1;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .react-calendar__tile--active {
            background: #2563eb !important;
            color: white !important;
            border-radius: 8px;
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
      />
    </div>
  );
}