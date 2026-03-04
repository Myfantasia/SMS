import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayouts';
import AdminDashboard from './pages/admin/AdminDashboard';
import PendingApprovals from './pages/admin/PendingApprovals';
import UserDirectory from './pages/admin/UserDirectory';
import ViewProfile from './pages/admin/ViewProfile';
import EditProfile from './pages/admin/EditProfile';
import AdminProfile from './pages/admin/AdminProfile';
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

          {/* Existing Approvals Route */}
          <Route path="approvals/:userType" element={<PendingApprovals />} />

          {/* User Directory Routes */}

          <Route path="teachers" element={<UserDirectory userType="teachers" />} />
          <Route path="students" element={<UserDirectory userType="students" />} />
          <Route path="parents" element={<UserDirectory userType="parents" />} />

          {/* Admin Profile Route */}
          <Route path="profile" element={<AdminProfile />} />

          {/* action routes for user*/}

          <Route path=":userType/view/:id" element={<ViewProfile />} />
          <Route path=":userType/edit/:id" element={<EditProfile />} />

          
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