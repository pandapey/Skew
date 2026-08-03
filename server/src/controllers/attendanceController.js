import { attendanceService as svc } from '../services/attendanceService.js'
import { asyncHandler } from '../utils/asyncHandler.js'

// Thin controller for personal + org attendance actions.
export const attendanceController = {
  myHistory: asyncHandler(async (req, res) => res.json(await svc.myHistory(req.user, req.query))),
  // Personal analytics for the logged-in employee only (Average Hours, Overtime,
  // present/absent/leave counts) over a selected period.
  mySummary: asyncHandler(async (req, res) => res.json(await svc.mySummary(req.user, req.query))),
  dayRecords: asyncHandler(async (req, res) => res.json(await svc.dayRecords(req.query))),
  today: asyncHandler(async (req, res) => res.json((await svc.getToday(req.user)) || { status: 'Not Marked' })),
  checkIn: asyncHandler(async (req, res) => res.status(201).json(await svc.checkIn(req.user, req.body))),
  checkOut: asyncHandler(async (req, res) => res.json(await svc.checkOut(req.user, req.body))),
  toggleBreak: asyncHandler(async (req, res) => res.json(await svc.toggleBreak(req.user, req.body))),
  calendar: asyncHandler(async (req, res) => res.json(await svc.calendar(req.user))),
  stats: asyncHandler(async (req, res) => res.json(await svc.stats(req.query))),
}
