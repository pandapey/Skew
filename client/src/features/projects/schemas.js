import { z } from 'zod'

const req = (msg) => z.string().min(1, msg)

const WEBSITE_RE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?(\/[^\s]*)?$/i
const website = z.string().trim()
  .refine((v) => !v || WEBSITE_RE.test(v), 'Enter a valid website (e.g. acme.com)')
  .optional()

export const projectSchema = z.object({
  name: req('Project name required'),
  client: req('Client required'),
  description: z.string().optional(),
  lead: z.string().optional(),
  status: z.string().optional(),
  website,
  plan: z.string().optional(),
})

export const taskSchema = z.object({
  title: req('Title required'),
  description: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  severity: z.string().optional(),
  assignee: z.string().optional(),
  storyPoints: z.coerce.number().min(0).optional(),
  dueDate: z.string().optional(),
  project: z.string().optional(),
  sprint: z.string().optional(),
})

export const sprintSchema = z.object({
  name: req('Sprint name required'),
  goal: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.string().optional(),
})

export const milestoneSchema = z.object({
  title: req('Milestone title required'),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.string().optional(),
  progress: z.coerce.number().min(0).max(100).optional(),
})

export const commentSchema = z.object({
  body: req('Write something first'),
})

export const memberSchema = z.object({
  name: req('Member name required'),
  role: z.string().optional(),
})

export const fileSchema = z.object({
  name: req('File name required'),
  type: z.string().optional(),
  url: z.string().optional(),
})
