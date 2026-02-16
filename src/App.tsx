import React from 'react';

const App = () => {
  return (
    <div className="p-10 bg-white shadow-lg rounded-xl border border-gray-200 m-5">
      <h1 className="text-3xl font-bold text-blue-600 mb-4">
        React + Tailwind + Django 🚀
      </h1>
      <p className="text-gray-600 text-lg">
        If you can see this styled card, your integration is working perfectly!
      </p>
      <button className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
        Click Me
      </button>
    </div>
  );
};

export default App;