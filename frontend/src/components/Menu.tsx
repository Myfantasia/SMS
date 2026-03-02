import { Link, useLocation } from 'react-router-dom';
import { 
  Home, 
  GraduationCap, 
  Users, 
  UserSquare2, 
  CheckSquare, 
  CircleDollarSign, 
  Megaphone, 
  UserPlus, 
  User, 
  LogOut,
  Layers,        // For Classes
  BookOpen,      // For Subjects
  Presentation,  // For Lessons
  FileSignature, // For Exams
  FileEdit,      // For Assignments
  Award,         // For Results
  Calendar       // For Events
} from 'lucide-react';

interface MenuProps {
  userRole: 'admin' | 'teacher' | 'student' | 'parent';
}

const menuItems = [
  {
    title: "MANAGEMENT",
    items: [
      // General
      { icon: Home, label: "Dashboard", href: "/admin-dashboard", visible: ["admin", "teacher", "student", "parent"] },
      
      // People
      { icon: GraduationCap, label: "Teachers", href: "/admin-dashboard/teachers", visible: ["admin", "teacher"] },
      { icon: Users, label: "Students", href: "/admin-dashboard/students", visible: ["admin", "teacher"] },
      { icon: UserSquare2, label: "Parents", href: "/admin-dashboard/parents", visible: ["admin", "teacher"] },
      
      // Academic Structure (Teachers & Admins build this)
      { icon: Layers, label: "Classes", href: "/admin-dashboard/classes", visible: ["admin", "teacher"] },
      { icon: BookOpen, label: "Subjects", href: "/admin-dashboard/subjects", visible: ["admin", "teacher", "student"] },
      { icon: Presentation, label: "Lessons", href: "/admin-dashboard/lessons", visible: ["admin", "teacher", "student"] },
      
      // Assessment & Evaluation (Students take them, Parents view them)
      { icon: FileSignature, label: "Exams", href: "/admin-dashboard/exams", visible: ["admin", "teacher", "student"] },
      { icon: FileEdit, label: "Assignments", href: "/admin-dashboard/assignments", visible: ["admin", "teacher", "student", "parent"] },
      { icon: Award, label: "Results", href: "/admin-dashboard/results", visible: ["admin", "teacher", "student", "parent"] },
      
      // Tracking & Operations
      { icon: CheckSquare, label: "Attendance", href: "/admin-dashboard/attendance", visible: ["admin", "teacher", "student", "parent"] },
      { icon: Calendar, label: "Events", href: "/admin-dashboard/events", visible: ["admin", "teacher", "student", "parent"] },
      { icon: Megaphone, label: "Notices", href: "/admin-dashboard/notices", visible: ["admin", "teacher", "student", "parent"] },
      
      // Sensitive Data
      { icon: CircleDollarSign, label: "Fees & Salary", href: "/admin-dashboard/finance", visible: ["admin"] },
    ],
  },
  {
    title: "APPROVALS",
    items: [
      { icon: UserPlus, label: "Pending Teachers", href: "/admin-dashboard/approve-teachers", visible: ["admin"] },
      { icon: UserPlus, label: "Pending Students", href: "/admin-dashboard/approve-students", visible: ["admin"] },
      { icon: UserPlus, label: "Pending Parents", href: "/admin-dashboard/approve-parents", visible: ["admin"] },
    ],
  },
  {
    title: "USER",
    items: [
      { icon: User, label: "Profile", href: "/profile", visible: ["admin", "teacher", "student", "parent"] },
      { icon: LogOut, label: "Logout", href: "/logout", visible: ["admin", "teacher", "student", "parent"] },
    ],
  },
];

export default function Menu({ userRole }: MenuProps) {
  const location = useLocation();

  return (
    <div className="mt-4 text-sm pb-8">
      {menuItems.map((section) => {
        // Filter out items that the current user role is not allowed to see
        const visibleItems = section.items.filter(item => item.visible.includes(userRole));
        
        // If the entire section (like APPROVALS) is empty for a student, don't render the title at all
        if (visibleItems.length === 0) return null;

        return (
          <div className="flex flex-col gap-2" key={section.title}>
            <span className="hidden lg:block text-slate-400 font-bold my-4 text-xs tracking-wider">
              {section.title}
            </span>
            {visibleItems.map((item) => {
              const isActive = location.pathname === item.href;
              const IconComponent = item.icon; 
              
              return (
                <Link
                  to={item.href}
                  key={item.label}
                  className={`flex items-center justify-center lg:justify-start gap-4 py-2 md:px-2 rounded-md transition-colors ${
                    isActive ? "bg-blue-100 text-blue-700 font-semibold" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                >
                  <IconComponent className="w-5 h-5" />
                  <span className="hidden lg:block">{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}