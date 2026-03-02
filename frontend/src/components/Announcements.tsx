import React from 'react';

// This interface should match your Django `Notice` model
interface Notice {
  id: number;
  message: string;
  by: string;
  date: string;
}

export default function Announcements({ notices }: { notices: Notice[] }) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-slate-700">Announcements</h1>
        <span className="text-xs text-slate-400 cursor-pointer">View All</span>
      </div>
      
      <div className="flex flex-col gap-4">
        {notices.length > 0 ? (
          notices.map((notice) => (
            <div key={notice.id} className="bg-blue-50 rounded-md p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-medium text-slate-700">By: {notice.by}</h2>
                <span className="text-xs text-slate-400 bg-white px-2 py-1 rounded-sm">{notice.date}</span>
              </div>
              <p className="text-sm text-slate-500 mt-2">{notice.message}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-400 text-center py-4">No recent announcements.</p>
        )}
      </div>
    </div>
  );
}