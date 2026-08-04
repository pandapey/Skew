import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FiAlertCircle, FiInfo } from 'react-icons/fi'
import { Modal, Button, Input, Select, Textarea } from '@/components/ui'
import {
  resolveLeaveDuration, countSundays, isSunday,
  HALF_DAY_SESSIONS, formatDays, MAX_LEAVE_DAYS_PER_REQUEST,
  // Phase 6.9 (TASK 2) company-holiday awareness + (TASK 16) per-type cap.
  toHolidaySet, isCompanyHoliday, listHolidaysInRange,
  isCapExemptLeaveType, maxDaysForRequest,
  // Phase 6.12 (TASK 4): overlapping-date detection, mirroring the server rule.
  findOverlappingLeave, formatLeaveSpan,
} from './constants'

const schema = z
  .object({
    type: z.string().min(1, 'Select a leave type'),
    from: z.string().min(1, 'Start date required'),
    to: z.string().min(1, 'End date required'),
    reason: z.string().min(3, 'Please provide a reason'),
    halfDay: z.boolean().optional(),
    halfDaySession: z.string().optional(),
  })
  .refine((d) => new Date(d.to) >= new Date(d.from), { message: 'End date must be after start date', path: ['to'] })
  // Part 4: Sundays are company holidays and cannot start or end a request.
  //
  // Phase 5.5 (Task 2): the past-date refinements were REMOVED. Whether a past
  // date is requestable depends on whether an Attendance record exists for it,
  // and the browser cannot answer that — it has no access to the Attendance
  // collection. Blocking every past date here was a client-side guess that
  // contradicted the real rule, so the decision now belongs solely to
  // leaveService.assertDatesAreRequestable() on the server.
  //
  // Phase 5.5 (Task 3): the 5-day cap IS safely checkable client-side, because
  // it is pure date arithmetic with no database dependency. The server still
  // re-applies it in leaveService.apply() against its own recomputed count.
  //
  // Phase 6.9 (TASK 16): the resolver-level refine can only enforce the FLAT
  // cap, because a zod schema has no access to the selected type's balance.
  // It is therefore skipped for the exempt types (Maternity / Paternity) and
  // the balance-aware ceiling is applied in the component below, where the
  // live `balances` prop is available. The server re-applies both in
  // leaveService.apply(), so skipping here cannot bypass the policy.
  .refine(
    (d) => isCapExemptLeaveType(d.type)
      || resolveLeaveDuration({ from: d.from, to: d.to, halfDay: d.halfDay }) <= MAX_LEAVE_DAYS_PER_REQUEST,
    { message: `A single request cannot exceed ${MAX_LEAVE_DAYS_PER_REQUEST} days`, path: ['to'] },
  )
  .refine((d) => !isSunday(d.from), { message: 'Sunday is a company holiday — pick another date', path: ['from'] })
  .refine((d) => !isSunday(d.to), { message: 'Sunday is a company holiday — pick another date', path: ['to'] })
  // Part 3: a half day is a single day, and the session must be chosen.
  .refine((d) => !d.halfDay || d.from === d.to, { message: 'A half day must start and end on the same date', path: ['to'] })
  .refine((d) => !d.halfDay || HALF_DAY_SESSIONS.includes(d.halfDaySession), { message: 'Choose First Half or Second Half', path: ['halfDaySession'] })

const EMPTY = { type: '', from: '', to: '', reason: '', halfDay: false, halfDaySession: '' }

// Phase 5.5 (Task 2): `todayISO()` and `isPastDate()` were deleted along with
// the `min` attribute and the past-date refinements they backed. Past dates are
// now legitimately selectable when no attendance exists for them, so keeping
// either helper would have left dead code enforcing a retired rule.

// Apply-leave form with live day-count, Sunday exclusion, half-day support and
// balance-aware validation. The server recomputes all of this on submit — these
// checks exist to give immediate feedback, not to be the source of truth.
// Phase 6.9 (TASK 2) ROOT CAUSE: Leave.jsx ALREADY fetched the company holidays
// (useQuery ['leave-holidays'] -> leaveApi.holidays) but never passed them into
// this modal, and the client mirror of the duration maths only excluded
// Sundays. The form therefore could not tell that a selected date was a
// declared Company Holiday, so the only thing that ever detected it was
// leaveService.apply() on the server; its 422 was surfaced by the global
// api/client.js response interceptor as a TOAST. The fix is not to intercept
// the toast — it is to give the form the data it was already loading so the
// breach is caught inline, in the SAME banner component the "maximum 5 days"
// rule uses. `holidays` is optional, so any other caller of this modal keeps
// working unchanged.
// Phase 6.12 (TASK 4) ROOT CAUSE: exactly the same shape of defect as the
// Company Holiday case above, one rule later. Overlapping leave dates were
// detected ONLY by leaveService.assertDatesAreRequestable() on the server,
// which throws 422 'These dates overlap an existing ... request'. The form had
// no access to the employee's other leave requests, so the breach could not be
// discovered until submit and the 422 arrived as a TOAST from the global
// api/client.js interceptor. Again the fix is NOT to swallow the toast - it is
// to feed the form the data the Leave page ALREADY loads (the ['leave-mine-all']
// query) so the clash is caught inline, in the SAME banner component the
// "maximum leave days exceeded" rule renders. `myRequests` is optional and
// defaults to [], so any other caller of this modal keeps working unchanged.
export function ApplyLeaveModal({ open, onClose, onSubmit, balances = [], holidays = [], myRequests = [], loading }) {
  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { ...EMPTY, type: balances[0]?.type || '' },
  })

  useEffect(() => { if (open) reset({ ...EMPTY, type: balances[0]?.type || '' }) }, [open]) // eslint-disable-line

  const [type, from, to, halfDay, halfDaySession] = watch(['type', 'from', 'to', 'halfDay', 'halfDaySession'])

  // A half day is always a single date — keep `to` pinned to `from`.
  useEffect(() => {
    if (halfDay && from) setValue('to', from, { shouldValidate: true })
  }, [halfDay, from, setValue])

  // Phase 6.9 (TASK 2): the SAME holiday list the page already loads, turned
  // into a lookup Set once per change instead of on every keystroke.
  const holidaySet = useMemo(() => toHolidaySet(holidays), [holidays])

  const days = resolveLeaveDuration({ from, to, halfDay, holidaySet })
  const sundays = halfDay ? 0 : countSundays(from, to)
  const selectedBalance = balances.find((b) => b.type === type)
  const insufficient = selectedBalance && days > selectedBalance.balance
  const sundayPicked = isSunday(from) || isSunday(to)

  // Phase 6.9 (TASK 2): declared Company Holidays inside the selected range,
  // and whether the range starts or ends on one. Both are rendered inline.
  const holidaysInRange = halfDay
    ? listHolidaysInRange(from, from, holidays)
    : listHolidaysInRange(from, to, holidays)
  const holidayPicked = isCompanyHoliday(from, holidaySet) || isCompanyHoliday(to, holidaySet)
  // A range made up entirely of Sundays / Company Holidays costs nothing and is
  // exactly what the server rejects with 'no working days'.
  const noWorkingDays = Boolean(from && to) && days <= 0

  // Phase 5.5 (Task 3) + Phase 6.9 (TASK 16): the per-request ceiling. Maternity
  // and Paternity leave are capped by the AVAILABLE BALANCE instead of the flat
  // 5-day policy limit; the rule itself lives in ./constants (mirroring
  // server/src/utils/leaveDays.js) so it is declared exactly once per side.
  const capExempt = isCapExemptLeaveType(type)
  const requestCap = maxDaysForRequest(type, selectedBalance?.balance)
  const overCap = Number.isFinite(requestCap) && days > requestCap

  // Phase 6.12 (TASK 4): the first Pending/Approved request of this employee
  // that collides with the selected range, or null. Half-day requests collapse
  // to the single `from` date, matching how the server stores and compares them.
  const overlapping = useMemo(
    () => findOverlappingLeave(myRequests, { from, to: halfDay ? from : to }),
    [myRequests, from, to, halfDay],
  )

  const submit = (values) => onSubmit({
    ...values,
    halfDay: Boolean(values.halfDay),
    halfDaySession: values.halfDay ? values.halfDaySession : null,
    // `days` is sent for display parity only; the server recalculates it.
    days,
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply for Leave"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {/* Phase 6.9 (TASK 2): a Company Holiday breach now blocks submit the
              same way the day cap does, so the server 422 (and its toast) is
              never reached in the first place. */}
          {/* Phase 6.12 (TASK 4): an overlap now blocks submit exactly like the
              day cap and the holiday breach do, so the server 422 - and the
              toast it produced - is never reached in the first place. */}
          <Button loading={loading} disabled={insufficient || sundayPicked || holidayPicked || noWorkingDays || overCap || Boolean(overlapping) || days <= 0} onClick={handleSubmit(submit)}>
            Submit Request
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <Select label="Leave Type" error={errors.type?.message} {...register('type')}
          options={balances.map((b) => ({ value: b.type, label: `${b.type} (${b.balance} left)` }))} />

        {/* Part 3: Half Day Leave */}
        <div className="rounded-xl border border-app p-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-app text-primary focus:ring-2 focus:ring-primary/40"
              {...register('halfDay')}
            />
            <span className="text-sm font-medium">Half Day Leave</span>
            <span className="text-xs text-muted">Deducts {formatDays(0.5)} from this balance</span>
          </label>

          {halfDay && (
            <fieldset className="mt-3 border-t border-app pt-3">
              <legend className="sr-only">Select which half of the day</legend>
              <div className="flex flex-wrap gap-4">
                {HALF_DAY_SESSIONS.map((session) => (
                  <label key={session} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value={session}
                      className="h-4 w-4 border-app text-primary focus:ring-2 focus:ring-primary/40"
                      {...register('halfDaySession')}
                    />
                    <span className={halfDaySession === session ? 'font-medium' : 'text-muted'}>{session}</span>
                  </label>
                ))}
              </div>
              {errors.halfDaySession?.message && (
                <p className="mt-2 text-xs text-danger">{errors.halfDaySession.message}</p>
              )}
            </fieldset>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Phase 5.5 (Task 2): no `min` — past dates must remain pickable so an
              employee can regularise a day that was never marked in attendance.
              The server rejects the ones that are actually accounted for. */}
          <Input label="From" type="date" error={errors.from?.message} {...register('from')} />
          <Input
            label="To"
            type="date"
            disabled={halfDay}
            error={errors.to?.message}
            {...register('to')}
          />
        </div>

        {/* Part 4: Sundays are non-working days and are never charged. */}
        <div className="flex items-start gap-2 text-xs text-muted">
          <FiInfo className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            Sundays and Company Holidays are never selectable and never deducted.{' '}
            {capExempt
              ? `${type} is limited only by your available balance.`
              : `A single request may cover up to ${MAX_LEAVE_DAYS_PER_REQUEST} days.`}{' '}
            Past dates can be requested only if no attendance was recorded for them.
          </p>
        </div>

        {/* Phase 5.5 (Task 3) + Phase 6.9 (TASK 16): explicit cap breach.
            Maternity / Paternity are bounded by the available balance. */}
        {overCap && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger" aria-live="polite">
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              {capExempt ? (
                <>
                  This request covers {formatDays(days)}, which exceeds your available {type} balance of{' '}
                  {formatDays(requestCap)}. {type} is not limited to {MAX_LEAVE_DAYS_PER_REQUEST} days per request — it
                  is limited by your remaining balance.
                </>
              ) : (
                <>
                  This request covers {formatDays(days)}, which exceeds the {MAX_LEAVE_DAYS_PER_REQUEST}-day maximum for a
                  single request. Please split it into separate requests.
                </>
              )}
            </p>
          </div>
        )}

        {/* Phase 6.12 (TASK 4): overlapping leave dates, rendered INLINE using
            the IDENTICAL banner treatment as the cap message above - same
            wrapper classes, same FiAlertCircle icon, same aria-live - because
            the brief requires the same design and the same validation
            component, not a new one. */}
        {overlapping && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger" aria-live="polite">
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              These dates overlap an existing {String(overlapping.status || '').toLowerCase()} {overlapping.type} request
              ({formatLeaveSpan(overlapping)}). Cancel or amend that request first, or pick dates that do not overlap it.
            </p>
          </div>
        )}

        {/* Phase 6.9 (TASK 2): Company Holiday validation, rendered INLINE with
            the exact same banner treatment as the cap message above instead of
            arriving as a toast from the server error interceptor. */}
        {holidayPicked && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger" aria-live="polite">
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              {isSunday(from) || isSunday(to)
                ? 'Sunday is a company holiday and cannot start or end a leave request. Please pick another date.'
                : 'A Company Holiday cannot start or end a leave request. Please pick another date.'}
            </p>
          </div>
        )}

        {!holidayPicked && noWorkingDays && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger" aria-live="polite">
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              The selected range contains no working days after excluding Sundays and Company Holidays. Please choose a
              range that includes at least one working day.
            </p>
          </div>
        )}

        {/* Informational, not blocking: holidays that merely fall INSIDE the
            range are simply not charged, so this uses the neutral treatment. */}
        {!holidayPicked && !noWorkingDays && holidaysInRange.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-app bg-primary/5 p-3 text-sm" aria-live="polite">
            <FiInfo className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              {holidaysInRange.length === 1 ? 'A Company Holiday falls' : `${holidaysInRange.length} Company Holidays fall`}{' '}
              inside this range and {holidaysInRange.length === 1 ? 'is' : 'are'} not deducted:{' '}
              {holidaysInRange.map((h) => `${h.name} (${h.date})`).join(', ')}.
            </p>
          </div>
        )}

        {/* Live day count + balance check */}
        {days > 0 && (
          <div
            className={`flex items-center justify-between rounded-xl border p-3 text-sm ${insufficient ? 'border-danger/40 bg-danger/5 text-danger' : 'border-app bg-primary/5'}`}
            aria-live="polite"
          >
            <span className="font-medium">
              {formatDays(days)} requested
              {halfDay && halfDaySession ? ` · ${halfDaySession}` : ''}
              {sundays > 0 ? ` · ${sundays} Sunday${sundays > 1 ? 's' : ''} excluded` : ''}
            </span>
            {selectedBalance && (
              <span className={insufficient ? 'flex items-center gap-1 font-medium' : 'text-muted'}>
                {insufficient && <FiAlertCircle />}
                {selectedBalance.balance} available
              </span>
            )}
          </div>
        )}

        <Textarea label="Reason" placeholder="Briefly describe the reason for your leave…" error={errors.reason?.message} {...register('reason')} />
      </form>
    </Modal>
  )
}
