import { Link, useLocation } from 'react-router-dom';
import { clearActivity } from '../libs/sessionExpiry';
import { ROLE_ACCENTS } from '../public/theme/publicTheme';
import { NAV_SECTIONS, isNavItemVisible, type DashboardRole } from '../libs/navCatalog';

interface MenuProps {
  userRole: DashboardRole;
  isClassTeacher?: boolean;
  requiresPathwayChoice?: boolean;
  permissions?: string[];
}

// The sidebar for every dashboard. What each item is, who sees it, and which permission code
// unlocks it for teachers/staff all live in libs/navCatalog.ts -- edit that file, not this one,
// when a module is added or its access rules change. The layout keeps `permissions` current, so
// this re-renders on its own when an admin changes the user's roles.
export default function Menu({ userRole, isClassTeacher = false, requiresPathwayChoice = false, permissions = [] }: MenuProps) {
  const location = useLocation();
  const accent = ROLE_ACCENTS[userRole] ?? '#2563EB';
  const ctx = { role: userRole, permissions, isClassTeacher, requiresPathwayChoice };

  return (
    <div className="mt-2 text-sm pb-8 flex flex-col gap-6">
      {NAV_SECTIONS.map((section) => {
        const visibleItems = section.items.filter((item) => isNavItemVisible(item, ctx));

        // If the entire section (like APPROVALS) is empty for a user, don't render the title at all
        if (visibleItems.length === 0) return null;

        return (
          <div className="flex flex-col gap-1" key={section.title}>
            <span className="block text-slate-400 dark:text-slate-500 font-bold mb-1 px-2 text-[10px] tracking-widest uppercase">
              {section.title}
            </span>
            {visibleItems.map((item) => {

              // 1. Force the logout link to use a standard 'a' tag to hit Django backend
              if (item.label === "Logout") {
                return (
                  <a
                    href={item.href}
                    key={item.label}
                    title={item.label}
                    onClick={clearActivity}
                    className="group flex items-center justify-start gap-3 py-2.5 px-2 lg:px-3 rounded-xl transition-colors text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300 font-medium"
                  >
                    <item.icon className="w-[18px] h-[18px] shrink-0" />
                    <span className="block text-[13px]">{item.label}</span>
                  </a>
                );
              }

              // 2. UNIVERSAL DASHBOARD ROUTING
              let dynamicHref = item.href;
              if (dynamicHref.startsWith("/admin-dashboard")) {
                dynamicHref = dynamicHref.replace("/admin-dashboard", `/${userRole}-dashboard`);
              }

              const isActive = location.pathname === dynamicHref;
              const IconComponent = item.icon;

              return (
                <Link
                  to={dynamicHref}
                  key={`${item.label}-${item.href}`}
                  title={item.label}
                  style={isActive ? { backgroundColor: accent } : undefined}
                  className={`relative flex items-center justify-start gap-3 py-2.5 px-2 lg:px-3 rounded-xl transition-all duration-150 ${
                    isActive
                      ? "text-white font-semibold shadow-sm shadow-blue-200 dark:shadow-none"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <IconComponent className={`w-[18px] h-[18px] shrink-0 ${isActive ? "text-white" : "text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300"}`} />
                  <span className="block text-[13px] truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
