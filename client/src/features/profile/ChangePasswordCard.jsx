// Phase 5.5 (Task 1) — self-serve password change, shared by EVERY role.
//
// This lives in one place and is rendered by both existing profile pages
// (pages/Profile.jsx for staff, features/client/ClientProfile.jsx for Client)
// rather than being written twice. The brief explicitly forbids duplicate
// profile pages, so no new route or page is introduced — this is a card added
// to the profile surfaces that already exist.
//
// The strength rules below MIRROR validatePasswordStrength() in
// server/src/controllers/authController.js. The server is the authority and
// re-validates every submission; these checks exist purely so the user gets
// immediate feedback instead of a round-trip per typo.
//
// =============================================================================
// Phase 6.20 (TASK 4) ROOT CAUSE - no show/hide (eye) toggle on My Profile ->
// Change Password, for Clients and staff alike.
//
// It was never "missing" in the sense of being broken or hidden: this card
// simply never used the component that owns that behaviour. It rendered three
// bare <Input type="password"> fields directly, while the eye toggle lives in
// features/admin/PasswordField.jsx - the wrapper that pairs Input with a
// `trailing` button flipping type between 'password' and 'text'. Admin Users,
// UserDetail and the HR entity forms all render PasswordField and therefore all
// have the toggle; this one surface bypassed it, so there was nothing to click.
//
// FIX: render the EXISTING PasswordField for all three fields. That is a pure
// substitution - PasswordField forwards every other prop straight through to
// the same Input, so label, value, onChange, error and autoComplete behave
// exactly as before, and the existing eye icon (FiEye / FiEyeOff) comes along
// with it. No new password component, no second toggle implementation, and the
// validation + live strength checklist below are untouched.
// =============================================================================
import { useState } from 'react'
import { FiLock, FiCheck, FiX } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { Card, CardHeader, Button } from '@/components/ui'
// Phase 6.20 (TASK 4): the SAME PasswordField admin/Users, admin/UserDetail and
// hr/EntityFormFields already render. Not re-implemented here.
import { PasswordField } from '@/features/admin/PasswordField'
import { authService } from '@/api/services'

export const PASSWORD_MIN_LENGTH = 8

// Each rule is data, not a hardcoded if-chain, so the checklist below and the
// submit guard can never drift apart.
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
      // Clear immediately: leaving credentials in component state after a
      // successful rotation serves no purpose.
      setForm(EMPTY)
      toast.success('Password changed successfully')
    } catch (err) {
      // Surface the SERVER's message (wrong current password, reuse, strength)
      // rather than inventing one, so the user sees the authoritative reason.
      toast.error(err?.response?.data?.message || err?.message || 'Could not change password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Change Password" subtitle="Update the password you use to sign in." />
      <form onSubmit={submit} className="space-y-4">
        {/* PasswordField owns `type`, so it is deliberately NOT passed here -
            the component toggles it between 'password' and 'text' itself.
            `autoComplete` IS passed: PasswordField defaults it to
            'new-password' but spreads {...props} afterwards, so this override
            wins and the browser still treats the first field as the current
            credential. */}
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
