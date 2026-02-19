// frontend/src/App.tsx
import React, { useEffect, useState } from 'react';

// Define the shape of the data we expect from Django
interface DashboardData {
  student_count: number;
  teacher_count: number;
  message: string;
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    // Fetch data from the Django API
    fetch('/api/dashboard-stats/')
      .then(response => response.json())
      .then(data => setData(data))
      .catch(error => console.error("Error fetching data:", error));
  }, []);

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h1>School Management System</h1>
      <h2 style={{ color: '#555' }}>Integration Test</h2>

      {data ? (
        <div style={{ marginTop: '30px' }}>

          {/* Stats Container */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px' }}>

            {/* Student Card */}
            <div style={{
              border: '1px solid #ddd', padding: '20px', borderRadius: '10px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)', width: '200px'
            }}>
              <h3>Students</h3>
              <p style={{ fontSize: '32px', fontWeight: 'bold', color: '#2c3e50', margin: 0 }}>
                {data.student_count}
              </p>
            </div>

            {/* Teacher Card */}
            <div style={{
              border: '1px solid #ddd', padding: '20px', borderRadius: '10px',
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)', width: '200px'
            }}>
              <h3>Teachers</h3>
              <p style={{ fontSize: '32px', fontWeight: 'bold', color: '#2c3e50', margin: 0 }}>
                {data.teacher_count}
              </p>
            </div>

          </div>

          <p style={{ marginTop: '30px', color: 'green', fontWeight: 'bold' }}>
            {data.message}
          </p>

        </div>
      ) : (
        <p>Loading data from Django...</p>
      )}
    </div>
  );
}

export default App;