import { z } from 'zod'

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
  salary: z.coerce.number().min(0, 'Salary must be positive'),
  joiningDate: z.string().optional(),
  experience: z.string().optional(),
  emergencyContact: z.string().optional(),
  status: z.string().optional(),
  role: z.string().optional(),
  avatar: z.string().optional(),
  shift: z.string().optional(),
  reportingTo: z.string().optional(),
  dob: z.string().optional(),
  bloodGroup: z.string().optional(),
  maritalStatus: z.string().optional(),
  address: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankIfsc: z.string().optional(),
  skills: z
    .array(
      z.object({
        name: z.string().min(1, 'Skill name is required'),
        level: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Expert']).optional(),
      }),
    )
    .optional(),
})

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
