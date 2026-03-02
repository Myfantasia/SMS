import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayouts';
import AdminDashboard from './pages/admin/AdminDashboard';
// import TeacherDashboard from './pages/teacher/TeacherDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Redirect root access to the admin dashboard by default */}
        <Route path="/" element={<Navigate to="/admin-dashboard" replace />} />
        
        {/* Admin Route Group wrapped in the Layout */}
        <Route path="/admin-dashboard/*" element={<DashboardLayout role="admin" />}>
          <Route index element={<AdminDashboard />} />
          {/* Future routes based on your Django URLs will be added here */}
          {/* <Route path="teachers" element={<AdminTeacherList />} /> */}
          {/* <Route path="students" element={<AdminStudentList />} /> */}
          {/* <Route path="parents" element={<AdminParentList />} /> */}
        </Route>

        {/* Teacher Route Group (Ready for future integration) */}
        {/* <Route path="/teacher-dashboard/*" element={<DashboardLayout role="teacher" />}>
          <Route index element={<TeacherDashboard />} />
        </Route> */}

        {/* Catch-all route to prevent 404 errors */}
        <Route path="*" element={<Navigate to="/admin-dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}