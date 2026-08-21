export function toEmployeeCreatePayload(values) {
  const {
    confirmPassword, salary, experience, reportingTo,
    dob, bloodGroup, maritalStatus, address, skills,
    bankName, bankAccount, bankIfsc,
    ...rest
  } = values
  return {
    ...rest,
    salaryCtc: Number(salary) || 0,
    experienceYears: experience || '',
    ...(reportingTo ? { reportingManager: reportingTo } : {}),
  }
}

export function toEmployeeUpdatePayload(values) {
  const {
    confirmPassword, password, bankName, bankAccount, bankIfsc,
    empCode, role, employeeId,
    ...rest
  } = values

  const payload = { ...rest }

  // Empty date inputs arrive as '' which Mongoose cannot cast to a Date.
  if (payload.joiningDate === '') delete payload.joiningDate
  if (payload.dob === '') delete payload.dob

  const hasBankFields = ['bankName', 'bankAccount', 'bankIfsc']
    .some((k) => Object.prototype.hasOwnProperty.call(values, k))
  if (hasBankFields) {
    payload.bank = {
      name: (bankName || '').trim(),
      account: (bankAccount || '').trim(),
      ifsc: (bankIfsc || '').trim(),
    }
  }

  return payload
}
