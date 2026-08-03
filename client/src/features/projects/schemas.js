import { z } from 'zod'

const req = (msg) => z.string().min(1, msg)

// Phase 6.9 (TASK 11): Client and Budget are now REQUIRED on project creation,
// mirroring the server-side rule in server/src/validators/projectValidators.js.
// Members is the third required field, but it is not part of this object because
// the member picker is component state (`memberNames`) rather than a registered
// input - ProjectModal validates it in its own submit handler.
export const projectSchema = z.object({
  name: req('Project name required'),
  code: z.string().optional(),
  client: req('Client required'),
  description: z.string().optional(),
  lead: z.string().optional(),
  priority: z.string().optional(),
  status: z.string().optional(),
  // A cleared number input yields '', which z.coerce.number() would silently
  // turn into 0 and accept. Normalising '' to undefined first is what lets the
  // field be genuinely required while still allowing a deliberate 0.
  budget: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number({
      required_error: 'Budget required',
      invalid_type_error: 'Budget must be a number',
    }).min(0, 'Budget cannot be negative'),
  ),
  startDate: z.string().optional(),
  deadline: z.string().optional(),
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
