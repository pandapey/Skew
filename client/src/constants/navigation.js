import {
  FiHome, FiUsers, FiClock, FiCalendar, FiBriefcase,
  FiTrello, FiDollarSign, FiBell, FiFolder, FiPieChart,
  FiSettings, FiMessageSquare, FiCreditCard,
  FiVideo, FiSpeaker, FiUser, FiCheckSquare, FiGlobe, FiZap,
} from 'react-icons/fi'
import { ROLES } from './index'

const A = null

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: FiHome, roles: A },
  { key: 'my-tasks', label: 'My Tasks', path: '/my-tasks', icon: FiCheckSquare, roles: [ROLES.EMPLOYEE], badge: 'my-tasks' },
  { key: 'employees', label: 'Employees', path: '/employees', icon: FiUsers,
    roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { key: 'hr', label: 'HR', path: '/hr', icon: FiBriefcase,
    roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { key: 'clients', label: 'Clients', path: '/clients', icon: FiGlobe,
    roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { key: 'projects', label: 'Projects', path: '/projects', icon: FiTrello, roles: A },
  { key: 'attendance', label: 'Attendance', path: '/attendance', icon: FiClock, roles: A },
  { key: 'task-reviews', label: 'Task Reviews', path: '/projects/reviews', icon: FiCheckSquare,
    roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { key: 'calendar', label: 'Calendar', path: '/calendar', icon: FiCalendar, roles: A },
  { key: 'files', label: 'Files', path: '/files', icon: FiFolder, roles: A },
  { key: 'announcements', label: 'Announcements', path: '/announcements', icon: FiSpeaker, roles: A, badge: 'announcements' },
  { key: 'chat', label: 'Chat', path: '/chat', icon: FiMessageSquare, roles: A, badge: 'chat' },
  { key: 'notifications', label: 'Notifications', path: '/notifications', icon: FiBell, roles: A, badge: 'notifications' },
  { key: 'reports', label: 'Reports', path: '/reports', icon: FiPieChart,
    roles: [ROLES.ADMIN, ROLES.MANAGER] },
  { key: 'admin', label: 'Admin Panel', path: '/admin', icon: FiSettings,
    roles: [ROLES.ADMIN] },
  { key: 'profile', label: 'My Profile', path: '/profile', icon: FiUser,
    roles: [ROLES.ADMIN, ROLES.MANAGER] },
]

export const CLIENT_NAV = [
  { key: 'client-dashboard', label: 'Dashboard', path: '/client', icon: FiHome },
  { key: 'client-projects', label: 'My Projects', path: '/client/projects', icon: FiTrello },
  { key: 'client-billing', label: 'Billing & Payments', path: '/client/billing', icon: FiCreditCard },
  { key: 'client-meetings', label: 'Meetings', path: '/client/meetings', icon: FiVideo },
  { key: 'client-notifications', label: 'Notifications', path: '/client/notifications', icon: FiBell },
  { key: 'client-profile', label: 'My Profile', path: '/client/profile', icon: FiUser },
]
