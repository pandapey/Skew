import { CheckInCard } from '@/features/attendance/CheckInCard'

// Thin registry wrapper — `CheckInCard` (features/attendance) is reused
// unmodified so Dashboard and the Attendance page share one check-in/out
// implementation instead of two independently-drifting ones.
export default function CheckInWidget() {
  return <CheckInCard />
}
