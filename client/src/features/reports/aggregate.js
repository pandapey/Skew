// Reports filter option sources for the Reports page dropdowns.
//
// This module previously bundled client-side aggregations over deleted mock
// data sets. The actual report data now comes from the backend via
// reportService (apiClient -> /api/reports/*), so those mock aggregations are
// gone. The only remaining exports are the dropdown option lists consumed by
// pages/Reports.jsx — sourced from real feature constants / the live backend.

import { DEPARTMENTS as EMPLOYEE_DEPARTMENTS } from '@/features/employees/constants'

// Department filter options (real constant, mirrors the backend employee model).
export const DEPARTMENTS = EMPLOYEE_DEPARTMENTS
