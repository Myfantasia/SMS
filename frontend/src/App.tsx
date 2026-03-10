import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import DashboardLayout from './layouts/DashboardLayouts';
import AdminDashboard from './pages/admin/AdminDashboard';
import PendingApprovals from './pages/admin/PendingApprovals';
import UserDirectory from './pages/admin/UserDirectory';
import ViewProfile from './pages/admin/ViewProfile';
import EditProfile from './pages/admin/EditProfile';
import AdminProfile from './pages/admin/AdminProfile';
import SearchResults from './components/SearchResults';
import AcademicHub from './components/academics/AcademicHub';
import SubjectsPage from './components/lists pages/SubjectsPage';
import ClassesPage from './components/lists pages/ClassesPage';
import ViewSubject from './components/action routes/ViewSubject';
import ViewClass from './components/action routes/ViewClass';
import EditSubject from './components/action routes/EditSubject';
import EditClass from './components/action routes/EditClass';
// import TeacherDashboard from './pages/teacher/TeacherDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#334155', // Slate-700 background for a pro look
            color: '#fff',
          },
          success: {
            style: { background: '#059669' }, // Emerald-600 for success
          },
          error: {
            style: { background: '#dc2626' }, // Red-600 for errors
          },
        }}
      />
      <Routes>
        {/* Redirect root access to the admin dashboard by default */}
        <Route path="/" element={<Navigate to="/admin-dashboard" replace />} />
        
        {/* Admin Route Group wrapped in the Layout */}
        <Route path="/admin-dashboard/*" element={<DashboardLayout role="admin" />}>
          <Route index element={<AdminDashboard />} />

          <Route path="search" element={<SearchResults />} />

          {/* Existing Approvals Route */}
          <Route path="approvals/:userType" element={<PendingApprovals />} />

          {/* User Directory Routes */}
          <Route path="teachers" element={<UserDirectory userType="teachers" />} />
          <Route path="students" element={<UserDirectory userType="students" />} />
          <Route path="parents" element={<UserDirectory userType="parents" />} />

          <Route path="academics" element={<AcademicHub />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="subjects" element={<SubjectsPage />} />

          {/* Admin Profile Route */}
          <Route path="profile" element={<AdminProfile />} />

          {/* action routes for user*/}

          <Route path=":userType/view/:id" element={<ViewProfile />} />
          <Route path=":userType/edit/:id" element={<EditProfile />} />


          <Route path="classes/view/:id" element={<ViewClass />} />
          <Route path="subjects/view/:id" element={<ViewSubject />} />

          <Route path="classes/edit/:id" element={<EditClass />} />
          <Route path="subjects/edit/:id" element={<EditSubject />} />

          
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