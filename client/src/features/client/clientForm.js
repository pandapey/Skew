import { z } from 'zod'
import { validatePassword } from '@/features/admin/password'
import { ROLES } from '@/constants'
import { clientService } from '@/features/client/clientService'

export const CLIENT_WRITE_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

export const clientShape = {
  company: z.string().min(2, 'Company name required'),
  contactPerson: z.string().min(2, 'Contact person required'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  gst: z.string().optional(),
  address: z.string().optional(),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
}

export const clientPasswordRefine = (val, ctx) => {
  const pw = val.password || ''
  const cpw = val.confirmPassword || ''
  if (!pw && !cpw) return
  if (!validatePassword(pw).valid) {
    ctx.addIssue({
      path: ['password'],
      code: z.ZodIssueCode.custom,
      message: 'Password must be 8–64 chars with upper, lower, number & special',
    })
  }
  if (pw !== cpw) {
    ctx.addIssue({
      path: ['confirmPassword'],
      code: z.ZodIssueCode.custom,
      message: 'Passwords do not match',
    })
  }
}

export const clientSchema = z.object(clientShape).superRefine(clientPasswordRefine)

export const CLIENT_FIELDS = [
  { name: 'company', label: 'Company Name', placeholder: 'Acme Corp' },
  { name: 'contactPerson', label: 'Contact Person', placeholder: 'Jane Doe' },
  { name: 'email', label: 'Business Email', type: 'email', placeholder: 'jane@acme.com' },
  { name: 'phone', label: 'Phone', placeholder: '+91 ...' },
  { name: 'gst', label: 'GST Number', placeholder: '29AAAAA0000A1Z2' },
  { name: 'address', label: 'Address', full: true, placeholder: 'Street, City, PIN' },
]

export const CLIENT_CREDENTIAL_FIELDS = [
  { name: 'password', label: 'Password', type: 'password', createOnly: true, strength: true },
  { name: 'confirmPassword', label: 'Confirm Password', type: 'password', createOnly: true, match: 'password' },
]

export const CLIENT_FORM_FIELDS = [
  ...CLIENT_FIELDS,
  ...CLIENT_CREDENTIAL_FIELDS,
]

export const CLIENT_FORM_DEFAULTS = {
  company: '', contactPerson: '', email: '', phone: '', gst: '',
  address: '',
  password: '', confirmPassword: '',
}

export const buildClientsApi = () => ({
  query: async (params = {}) => {
    const res = await clientService.listClients()
    const all = (Array.isArray(res) ? res : res?.data || []).map((c) => ({ ...c, id: c.clientId || c.id || c._id }))
    const term = (params.search || '').trim().toLowerCase()
    let rows = all
    if (term) {
      rows = rows.filter((c) =>
        [c.company, c.contactPerson, c.email]
          .some((v) => String(v || '').toLowerCase().includes(term))
      )
    }
    if (params.status) rows = rows.filter((c) => c.status === params.status)
    const total = rows.length
    const limit = Number(params.limit) || 8
    const page = Number(params.page) || 1
    const start = (page - 1) * limit
    return { data: rows.slice(start, start + limit), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) }
  },

  create: ({ confirmPassword, industry, ...values }) => clientService.createClient(values),

  update: (id, { password, confirmPassword, industry, ...values }) => clientService.updateClient(id, values),

  remove: (id) => clientService.removeClient(id),
})
