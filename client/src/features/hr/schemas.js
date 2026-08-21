import { z } from 'zod'

const req = (msg) => z.string().min(1, msg)

export const departmentSchema = z.object({
  name: req('Department name required'),
  code: req('Code required'),
  head: z.string().optional(),
  budget: z.coerce.number().min(0).optional(),
  status: z.string().optional(),
})

export const designationSchema = z.object({
  title: req('Title required'),
  department: req('Department required'),
  level: z.string().optional(),
  grade: z.string().optional(),
})

export const jobSchema = z.object({
  title: req('Job title required'),
  department: req('Department required'),
  location: z.string().optional(),
  type: z.string().optional(),
  openings: z.coerce.number().min(1).optional(),
  experience: z.string().optional(),
  status: z.string().optional(),
})

export const candidateSchema = z.object({
  name: req('Name required'),
  email: z.string().email('Valid email required'),
  phone: z.string().optional(),
  position: req('Position required'),
  experience: z.string().optional(),
  source: z.string().optional(),
  stage: z.string().optional(),
})

export const interviewSchema = z.object({
  candidate: req('Candidate required'),
  position: z.string().optional(),
  round: z.string().optional(),
  interviewer: req('Interviewer required'),
  date: z.string().optional(),
  time: z.string().optional(),
  mode: z.string().optional(),
  status: z.string().optional(),
})

export const offerSchema = z.object({
  candidate: req('Candidate required'),
  position: req('Position required'),
  department: z.string().optional(),
  ctc: z.coerce.number().min(0, 'CTC must be positive'),
  joiningDate: z.string().optional(),
  status: z.string().optional(),
})

export const reviewSchema = z.object({
  employee: req('Employee required'),
  employeeId: z.string().optional(),
  employeeCode: z.string().optional(),
  department: z.string().optional(),
  period: req('Period required'),
  reviewer: z.string().optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  goalCompletion: z.coerce.number().min(0).max(100).optional(),
  status: z.string().optional(),
  comments: z.string().optional(),
  strengths: z.string().optional(),
  areasForImprovement: z.string().optional(),
})

export const movementSchema = z.object({
  type: req('Type required'),
  employee: req('Employee required'),
  department: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  effectiveDate: z.string().optional(),
  reason: z.string().optional(),
  status: z.string().optional(),
})
