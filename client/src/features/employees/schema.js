import { z } from 'zod'

// Validation schema for the in-place Employee EDIT form. Account creation (and
// therefore password handling) now lives exclusively in Admin \u2192 Users, so this
// schema intentionally has no password / confirmPassword fields.
// Phase 6.2 (Task 5): this schema is now SHARED by the Employee form in both
// EDIT mode (unchanged behaviour) and CREATE mode. The create-only fields are
// declared optional here and tightened by employeeCreateSchema at the bottom,
// which simply .extend()s this object - so the 15 common field rules are
// defined exactly once and never duplicated.
export const employeeSchema = z.object({
  gender: z.string().optional(),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email required'),
  phone: z.string().min(6, 'Phone is required'),
  department: z.string().min(1, 'Select a department'),
  designation: z.string().min(1, 'Designation is required'),
  employmentType: z.string().optional(),
  workLocation: z.string().optional(),
  salary: z.coerce.number().min(0, 'Salary must be positive'),
  joiningDate: z.string().optional(),
  experience: z.string().optional(),
  emergencyContact: z.string().optional(),
  status: z.string().optional(),
  role: z.string().optional(),
  employeeId: z.string().optional(),
  avatar: z.string().optional(),
  // Phase 5.9.1: ROOT CAUSE of "no option to add skills" - Employee.skills has
  // always existed in the Mongo model (skillSchema: { name, level }) and the
  // employee DETAIL page already rendered them, but no schema key existed here.
  // zod's z.object() STRIPS unknown keys, so even if the form had sent skills,
  // the resolver would have silently deleted them before submit. Declaring the
  // key is therefore mandatory, not optional polish.
  // `level` mirrors the enum on skillSchema in server/src/models/Employee.js.
  skills: z
    .array(
      z.object({
        name: z.string().min(1, 'Skill name is required'),
        level: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Expert']).optional(),
      }),
    )
    .optional(),
})

// CREATE mode. password + gender are REQUIRED because the server requires them
// (userController.createUser -> assertGender + validatePassword). The rules
// below mirror server/src/utils/password.js so the user sees inline validation
// instead of a 400 round-trip; the server remains the authority either way.
export const employeeCreateSchema = employeeSchema
  .extend({
    gender: z.string().min(1, 'Gender is required'),
    password: z
      .string()
      .min(8, 'Minimum 8 characters')
      .max(64, 'Maximum 64 characters')
      .regex(/[A-Z]/, 'Must include an uppercase letter')
      .regex(/[a-z]/, 'Must include a lowercase letter')
      .regex(/[0-9]/, 'Must include a number')
      .regex(/[^A-Za-z0-9]/, 'Must include a special character'),
    confirmPassword: z.string().min(1, 'Confirm the password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
