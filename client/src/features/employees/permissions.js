import { ROLES } from '@/constants'

export const SALARY_EDIT_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

export const EMAIL_EDIT_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

export const STATUS_EDIT_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

export const EMPLOYEE_CREATE_ROLES = [ROLES.ADMIN, ROLES.MANAGER]


export const EMPLOYEE_EDIT_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

export function employeeFieldPermissions(role, mode = 'edit') {
  return {
    canEditSalary: SALARY_EDIT_ROLES.includes(role),
    canEditEmail: mode === 'create' || EMAIL_EDIT_ROLES.includes(role),
    canEditStatus: STATUS_EDIT_ROLES.includes(role),
  }
}

export function stripUnauthorizedEmployeeFields(values, role, mode = 'edit') {
  const out = { ...values }
  const perms = employeeFieldPermissions(role, mode)
  if (!perms.canEditSalary) {
    delete out.salary
    delete out.bank
    delete out.bankName
    delete out.bankAccount
    delete out.bankIfsc
  }
  if (!perms.canEditEmail) delete out.email
  if (!perms.canEditStatus) delete out.status
  return out
}
