// Announcement module constants: post categories, filter chips, icons.
import { FiFileText, FiBell, FiCalendar, FiGift } from 'react-icons/fi'

export const POST_TYPES = {
  news: {
    label: 'Company News',
    singular: 'News',
    tone: 'primary',
    color: '#2563EB',
    icon: FiFileText,
    dot: 'bg-primary',
    soft: 'bg-primary/10',
    text: 'text-primary',
  },
  announcement: {
    label: 'Announcements',
    singular: 'Announcement',
    tone: 'accent',
    color: '#06B6D4',
    icon: FiBell,
    dot: 'bg-accent',
    soft: 'bg-accent/10',
    text: 'text-accent',
  },
  event: {
    label: 'Events',
    singular: 'Event',
    tone: 'warning',
    color: '#F59E0B',
    icon: FiCalendar,
    dot: 'bg-warning',
    soft: 'bg-warning/10',
    text: 'text-warning',
  },
  birthday: {
    label: 'Birthdays',
    singular: 'Birthday',
    tone: 'success',
    color: '#10B981',
    icon: FiGift,
    dot: 'bg-success',
    soft: 'bg-success/10',
    text: 'text-success',
  },
}

export const TYPE_ORDER = ['news', 'announcement', 'event', 'birthday']

export const FILTERS = [
  { value: 'all', label: 'All' },
  ...TYPE_ORDER.map((t) => ({ value: t, label: POST_TYPES[t].label })),
]
