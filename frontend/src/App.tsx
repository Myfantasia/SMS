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
import TimetableManager from './components/timetable/TimetableManager';
import AttendanceHub from './components/attendaces/AttendanceHub';
import EventsHub from './components/events/EventsHub';
import NoticesHub from './components/notices/NoticesHub';
import ExamsHub from './components/exams/ExamsHub';
import ResultsHub from './components/results/ResultsHub';
import { auth } from './firebaseConfig';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import AllocationDashboard from './components/subjectAllocations/AllocationDashboard';
import { ChatProvider } from './components/chats/ChatProvider';
import AssignmentsHub from './components/assignments/AssignmentsHub';
import AdminChatDashboard from './components/chats/AdminChatDashboard';
import AssignmentCreator from './components/assignments/AssignmentCreator';
import SubmissionManager from './components/assignments/SubmissionManager';
import EditAssignment from './components/assignments/EditAssignments';


// 1. CATCH THE URL TOKEN AND SAVE TO LOCAL STORAGE
const urlParams = new URLSearchParams(window.location.search);
const tokenFromUrl = urlParams.get('token');
if (tokenFromUrl) {
  localStorage.setItem('firebase_dev_token', tokenFromUrl);
  window.history.replaceState({}, document.title, window.location.pathname);
}

export default function App() {

  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    // This listener actively waits for Firebase to check the browser's memory
    // Once Firebase confirms whether a user exists OR is definitely null, it fires.
    const unsubscribe = onAuthStateChanged(auth, () => {
      setIsAuthReady(true); // Tell React it's safe to render the app now!
    });

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, []);

  // Show a clean loading screen while Firebase is checking the session
  if (!isAuthReady) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-slate-500 font-medium">Restoring secure session...</p>
      </div>
    );
  }


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
      {/* --- NEW: WRAP ALL ROUTES IN THE CHAT PROVIDER --- */}
      {/* This ensures every page (including the Navbar) has access to chat data */}
      <ChatProvider>
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

            <Route path="allocations" element={<AllocationDashboard />} />

            {/* ADD THE TIMETABLE ROUTE */}
            <Route path="timetable" element={<TimetableManager />} />

            {/* --- ADD THE ATTENDANCE ROUTE HERE --- */}
            <Route path="attendance" element={<AttendanceHub  role='admin'/>} />

            <Route path="events" element={<EventsHub role="admin" />} />

            <Route path="notices" element={<NoticesHub role="admin" />} />

            <Route path="exams" element={<ExamsHub role="admin" />} />

            <Route path="results" element={<ResultsHub role="admin" />} />

            <Route path="assignments" element={<AssignmentsHub role="admin" />} />
            <Route path="assignments/create" element={<AssignmentCreator role="admin" />} />
            <Route path="assignments/:id/submissions" element={<SubmissionManager role="admin" />} />
            <Route path="assignments/edit/:id" element={<EditAssignment role="admin" />} />

            {/* --- NEW: MESSAGING ROUTE --- */}
            <Route path="messages" element={<AdminChatDashboard />} />
          </Route>

          {/* Teacher Route Group (Ready for future integration) */}
          {/* <Route path="/teacher-dashboard/*" element={<DashboardLayout role="teacher" />}>
          <Route index element={<TeacherDashboard />} />
           </Route> */}

          {/* Catch-all route to prevent 404 errors */}
          <Route path="*" element={<Navigate to="/admin-dashboard" replace />} />
        </Routes>
      </ChatProvider>
    </BrowserRouter>
  );
}