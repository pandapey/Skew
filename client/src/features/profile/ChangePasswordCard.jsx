import { useState } from 'react'
import { FiLock, FiCheck, FiX } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { Card, CardHeader, Button } from '@/components/ui'
import { PasswordField } from '@/features/admin/PasswordField'
import { authService } from '@/api/services'

export const PASSWORD_MIN_LENGTH = 8

const RULES = [
  { key: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { key: 'lower', label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { key: 'upper', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { key: 'number', label: 'One number', test: (v) => /[0-9]/.test(v) },
  { key: 'special', label: 'One special character', test: (v) => /[^A-Za-z0-9]/.test(v) },
]

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' }

export function ChangePasswordCard() {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const results = RULES.map((r) => ({ ...r, ok: r.test(form.newPassword) }))
  const strongEnough = results.every((r) => r.ok)
  const mismatch = Boolean(form.confirmPassword) && form.newPassword !== form.confirmPassword
  const reused = Boolean(form.newPassword) && form.newPassword === form.currentPassword
  const canSubmit =
    Boolean(form.currentPassword) && strongEnough && !mismatch && !reused && Boolean(form.confirmPassword)

  const submit = async (e) => {
    e.preventDefault()
    if (!canSubmit || saving) return
    setSaving(true)
    try {
      await authService.changePassword(form)
      setForm(EMPTY)
      toast.success('Password changed successfully')
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not change password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Change Password" subtitle="Update the password you use to sign in." />
      <form onSubmit={submit} className="space-y-4">
        <PasswordField
          label="Current Password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={set('currentPassword')}
        />
        <PasswordField
          label="New Password"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={set('newPassword')}
          error={reused ? 'New password must be different from your current password' : undefined}
        />
        <PasswordField
          label="Confirm New Password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={set('confirmPassword')}
          error={mismatch ? 'Passwords do not match' : undefined}
        />

        {/* Live strength checklist — only shown once the user starts typing. */}
        {form.newPassword && (
          <ul className="grid grid-cols-1 gap-1.5 rounded-xl border border-app p-3 sm:grid-cols-2" aria-live="polite">
            {results.map((r) => (
              <li
                key={r.key}
                className={`flex items-center gap-2 text-xs ${r.ok ? 'text-success' : 'text-muted'}`}
              >
                {r.ok ? <FiCheck className="shrink-0" aria-hidden="true" /> : <FiX className="shrink-0" aria-hidden="true" />}
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button type="submit" icon={FiLock} loading={saving} disabled={!canSubmit}>
            Change Password
          </Button>
        </div>
      </form>
    </Card>
  )
}

export default ChangePasswordCard
