import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FiAlertCircle, FiInfo } from 'react-icons/fi'
import { Modal, Button, Input, Select, Textarea } from '@/components/ui'
import {
  resolveLeaveDuration, countSundays, isSunday,
  HALF_DAY_SESSIONS, formatDays, MAX_LEAVE_DAYS_PER_REQUEST,
  toHolidaySet, isCompanyHoliday, listHolidaysInRange,
  isCapExemptLeaveType, maxDaysForRequest,
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

  .refine(
    (d) => isCapExemptLeaveType(d.type)
      || resolveLeaveDuration({ from: d.from, to: d.to, halfDay: d.halfDay }) <= MAX_LEAVE_DAYS_PER_REQUEST,
    { message: `A single request cannot exceed ${MAX_LEAVE_DAYS_PER_REQUEST} days`, path: ['to'] },
  )
  .refine((d) => !isSunday(d.from), { message: 'Sunday is a company holiday — pick another date', path: ['from'] })
  .refine((d) => !isSunday(d.to), { message: 'Sunday is a company holiday — pick another date', path: ['to'] })
  .refine((d) => !d.halfDay || d.from === d.to, { message: 'A half day must start and end on the same date', path: ['to'] })
  .refine((d) => !d.halfDay || HALF_DAY_SESSIONS.includes(d.halfDaySession), { message: 'Choose First Half or Second Half', path: ['halfDaySession'] })

const EMPTY = { type: '', from: '', to: '', reason: '', halfDay: false, halfDaySession: '' }

export function ApplyLeaveModal({ open, onClose, onSubmit, balances = [], holidays = [], myRequests = [], loading }) {
  const { register, handleSubmit, watch, reset, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { ...EMPTY, type: balances[0]?.type || '' },
  })

  useEffect(() => { if (open) reset({ ...EMPTY, type: balances[0]?.type || '' }) }, [open]) // eslint-disable-line

  const [type, from, to, halfDay, halfDaySession] = watch(['type', 'from', 'to', 'halfDay', 'halfDaySession'])

  useEffect(() => {
    if (halfDay && from) setValue('to', from, { shouldValidate: true })
  }, [halfDay, from, setValue])

  const holidaySet = useMemo(() => toHolidaySet(holidays), [holidays])

  const days = resolveLeaveDuration({ from, to, halfDay, holidaySet })
  const sundays = halfDay ? 0 : countSundays(from, to)
  const selectedBalance = balances.find((b) => b.type === type)
  const insufficient = selectedBalance && days > selectedBalance.balance
  const sundayPicked = isSunday(from) || isSunday(to)

  const holidaysInRange = halfDay
    ? listHolidaysInRange(from, from, holidays)
    : listHolidaysInRange(from, to, holidays)
  const holidayPicked = isCompanyHoliday(from, holidaySet) || isCompanyHoliday(to, holidaySet)
  const noWorkingDays = Boolean(from && to) && days <= 0

  const capExempt = isCapExemptLeaveType(type)
  const requestCap = maxDaysForRequest(type, selectedBalance?.balance)
  const overCap = Number.isFinite(requestCap) && days > requestCap

  const overlapping = useMemo(
    () => findOverlappingLeave(myRequests, { from, to: halfDay ? from : to }),
    [myRequests, from, to, halfDay],
  )

  const submit = (values) => onSubmit({
    ...values,
    halfDay: Boolean(values.halfDay),
    halfDaySession: values.halfDay ? values.halfDaySession : null,
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
          <Button loading={loading} disabled={insufficient || sundayPicked || holidayPicked || noWorkingDays || overCap || Boolean(overlapping) || days <= 0} onClick={handleSubmit(submit)}>
            Submit Request
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <Select label="Leave Type" error={errors.type?.message} {...register('type')}
          options={balances.map((b) => ({ value: b.type, label: `${b.type} (${b.balance} left)` }))} />

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
          <Input label="From" type="date" error={errors.from?.message} {...register('from')} />
          <Input
            label="To"
            type="date"
            disabled={halfDay}
            error={errors.to?.message}
            {...register('to')}
          />
        </div>

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

        {overlapping && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger" aria-live="polite">
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              These dates overlap an existing {String(overlapping.status || '').toLowerCase()} {overlapping.type} request
              ({formatLeaveSpan(overlapping)}). Cancel or amend that request first, or pick dates that do not overlap it.
            </p>
          </div>
        )}

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
