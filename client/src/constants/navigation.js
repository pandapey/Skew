import {
  // Phase 6.9 (TASK 6): FiUserCheck dropped - it was used only by the removed
  // Leave entry. FiClock / FiDollarSign / FiCheckSquare are still in use by
  // Attendance, Finance and My Tasks respectively.
  // Phase 6.10 (TASK 2 / TASK 6): FiList and FiFileText dropped - they were used
  // ONLY by the removed CLIENT_NAV "Project Timeline" and "Documents" entries.
  // FiMessageSquare and FiCheckSquare are KEPT: they are still used by the staff
  // NAV_ITEMS entries "Announcements" / "My Tasks" + "Task Reviews".
  FiHome, FiUsers, FiClock, FiCalendar, FiBriefcase,
  FiTrello, FiDollarSign, FiBell, FiFolder, FiPieChart,
  FiSettings, FiMessageSquare, FiCreditCard,
  FiVideo, FiSpeaker, FiUser, FiCheckSquare, FiGlobe,
} from 'react-icons/fi'
import { ROLES } from './index'

const A = null // null roles = all roles allowed

// Navigation config drives the sidebar and route generation.
export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: FiHome, roles: A },
  { key: 'employees', label: 'Employees', path: '/employees', icon: FiUsers,
    roles: [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER] },
  { key: 'hr', label: 'HR', path: '/hr', icon: FiBriefcase,
    roles: [ROLES.ADMIN, ROLES.HR] },
  // Phase 6.1 (Task 4): was roles: [ROLES.ADMIN], so HR/Manager had no Clients
  // entry in their sidebar. Employees and Projects were already visible to both
  // roles ([ADMIN,HR,MANAGER] and all-roles respectively), so Clients was the
  // ONLY missing menu item - no new nav tree or duplicate entries needed.
  // Server-side scoping decides what each role actually sees.
  { key: 'clients', label: 'Clients', path: '/clients', icon: FiGlobe,
    roles: [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER] },
  { key: 'projects', label: 'Projects', path: '/projects', icon: FiTrello, roles: A },
  // Phase 6.19 (TASK 3) ROOT CAUSE FIX: Leave has no NAV_ITEMS entry of its
  // own (see the Phase 6.9 (TASK 6) note below), so Sidebar.jsx's longest-
  // path-match highlighter found zero items matching '/leave' and highlighted
  // NOTHING while viewing Leave, including Attendance. `matchPaths` is an
  // additive alias list Sidebar.jsx also checks alongside `path` for the SAME
  // longest-match algorithm - it does not add a second nav entry or a second
  // matching rule, and every other item leaves `matchPaths` unset so their
  // highlight behaviour is unchanged.
  { key: 'attendance', label: 'Attendance', path: '/attendance', matchPaths: ['/leave'], icon: FiClock, roles: A },
  // Phase 6.9 (TASK 6): Leave is MERGED INTO Attendance. The duplicate sidebar
  // entry is removed; Leave is now reached via the "Leave" button on the
  // Attendance page. NOTHING about Leave functionality is removed - NAV_ITEMS
  // only feeds the Sidebar (layouts/Sidebar.jsx:18), while the routes are
  // declared independently in routes/index.jsx, so route('/leave', Leave) and
  // every /leave/* sub-route keep working exactly as before, including direct
  // links and browser history.
  // Employee-only self-service menus (Issues 5 & 6). Gated strictly to the
  // Employee role so they never appear for Admin/HR/Manager/etc.
  { key: 'my-tasks', label: 'My Tasks', path: '/my-tasks', icon: FiCheckSquare, roles: [ROLES.EMPLOYEE] },
  // Part 8: project-lead review queue. Visible to every staff role because a
  // project lead is normally an Employee; the server returns only the caller's
  // own queue, and the page shows an empty state when they lead nothing.
  // Phase 6.9 (TASK 9): ROLES.EMPLOYEE removed from this entry only. For an
  // Employee, Task Review is now reached from inside My Tasks, so keeping a
  // sidebar entry too would be the duplicate navigation the task asks us to
  // remove. Admin / HR / Manager have no "My Tasks" page, so they KEEP this
  // entry - their access is unchanged and no RBAC is weakened (the route
  // itself still admits Employees).
  { key: 'task-reviews', label: 'Task Reviews', path: '/projects/reviews', icon: FiCheckSquare,
    roles: [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER] },
  // Phase 5.5 (Task 5): one Task History entry for every staff role. An
  // employee lands on their own history; a lead/manager/admin/HR can pick a
  // project. Scoping happens server-side, so a single menu item is correct
  // here rather than two role-gated duplicates.
  // Phase 6.9 (TASK 7): Salary is MERGED INTO My Profile as a tab. The separate
  // sidebar entry is removed as duplicate navigation. route('/salary', ...) and
  // the /salary/history + /salary/report pages are untouched and still
  // reachable, both directly and from the new Salary tab.
  { key: 'calendar', label: 'Calendar', path: '/calendar', icon: FiCalendar, roles: A },
  { key: 'files', label: 'Files', path: '/files', icon: FiFolder, roles: A },
  { key: 'announcements', label: 'Announcements', path: '/announcements', icon: FiMessageSquare, roles: A },
  { key: 'notifications', label: 'Notifications', path: '/notifications', icon: FiBell, roles: A },
  { key: 'finance', label: 'Finance', path: '/finance', icon: FiDollarSign,
    roles: [ROLES.ADMIN, ROLES.HR] },
  { key: 'reports', label: 'Reports', path: '/reports', icon: FiPieChart,
    roles: [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER] },
  { key: 'admin', label: 'Admin Panel', path: '/admin', icon: FiSettings,
    roles: [ROLES.ADMIN] },
  // Phase 6.2 (Task 1) ROOT CAUSE: the profile screen was reachable ONLY from
  // the navbar avatar dropdown (layouts/Navbar.jsx -> navigate('/profile')).
  // The route and the page already existed (routes/index.jsx: route('/profile',
  // Profile) for STAFF_ROLES); what was missing was a NAV_ITEMS entry, which is
  // the single source the Sidebar filters over. Adding the entry therefore
  // exposes the EXISTING page - no second profile page, no duplicated logic.
  // roles: A (all staff roles) => Admin, HR, Manager, Employee. Clients are not
  // in NAV_ITEMS at all; they already have their own 'client-profile' entry in
  // CLIENT_NAV below, so every role is covered without a duplicate item.
  { key: 'profile', label: 'My Profile', path: '/profile', icon: FiUser, roles: A },
]

// Dedicated sidebar for the isolated Client Portal. Clients are intentionally
// NOT added to NAV_ITEMS above — they live entirely in their own /client/* tree
// so they can never reach internal staff modules. This list is fixed (no role
// filtering) and is passed directly to the Sidebar via its `items` prop.
export const CLIENT_NAV = [
  { key: 'client-dashboard', label: 'Dashboard', path: '/client', icon: FiHome },
  { key: 'client-projects', label: 'My Projects', path: '/client/projects', icon: FiTrello },
  // Phase 6.10 (TASK 2 / TASK 6): 'client-tasks', 'client-timeline',
  // 'client-documents' and 'client-messages' removed. Task Progress, Project
  // Timeline, Documents and Messages are now BUTTONS/TABS inside
  // '/client/projects/:id', so a client picks the project first instead of
  // picking it again from a <Select> on four separate account-wide pages. No
  // functionality is lost - the same components, queries and APIs render there.
  { key: 'client-billing', label: 'Billing & Payments', path: '/client/billing', icon: FiCreditCard },
  { key: 'client-meetings', label: 'Meetings', path: '/client/meetings', icon: FiVideo },
  // Phase 5.8 (Task 1): Announcements removed from the Client Portal only.
  // The Admin/HR/Manager/Employee `announcements` NAV_ITEMS entry above is untouched.
  // Phase 6.10 (TASK 4): Notifications. Uses FiBell, already imported for the
  // staff entry - the two are separate menus over separate models, not a
  // duplicated notification system.
  { key: 'client-notifications', label: 'Notifications', path: '/client/notifications', icon: FiBell },
  { key: 'client-profile', label: 'My Profile', path: '/client/profile', icon: FiUser },
]
