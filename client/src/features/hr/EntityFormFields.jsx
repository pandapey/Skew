import { PasswordField } from '@/features/admin/PasswordField'
import { PasswordStrength } from '@/features/admin/PasswordStrength'
import { Select, Input, Textarea, MultiSelect } from '@/components/ui'

// ---------------------------------------------------------------------------
// Phase 6.14 (TASK 3) - THE shared field renderer
// ---------------------------------------------------------------------------
// This is the field-rendering body that used to live inline inside
// EntityManager's create/edit <Modal>. It is lifted out VERBATIM (same order,
// same branches, same class names, same components) for one reason: TASK 3
// requires the Client Details page to edit a client, and the only renderer that
// understood the client `fields` config was locked inside EntityManager.
//
// Extracting it means Clients -> Add/Edit and Client Details -> Edit render the
// SAME inputs from the SAME config with the SAME validation. The alternative -
// hand-writing a client form on the details page - would have been a duplicate
// form, which the brief forbids. EntityManager now calls this component, so
// there is still exactly one implementation, not two.
//
// Props:
//   form         - the react-hook-form instance (owned by the caller)
//   fields       - [{ name, label, type, options, full, createOnly, ... }]
//   editing      - truthy while editing an existing record; hides createOnly
//   fieldOptions - { [name]: { options, loading } } for async multiselects
export function EntityFormFields({ form, fields = [], editing, fieldOptions = {} }) {
  return fields.map((f) => {
    const err = form.formState.errors[f.name]?.message
    const cls = f.full ? 'sm:col-span-2' : ''
    // Phase 6.6 (TASK 2): `createOnly` fields (i.e. passwords) are rendered only
    // while adding. Editing an existing record must never offer to overwrite a
    // credential inline - that is what the dedicated Reset Password flow is for.
    if (f.createOnly && editing) return null
    if (f.type === 'select') return <Select key={f.name} label={f.label} className={cls} options={f.options} error={err} {...form.register(f.name)} />
    if (f.type === 'textarea') return <Textarea key={f.name} label={f.label} className={cls} error={err} {...form.register(f.name)} />
    // Phase 6.14 (TASK 2): searchable multi-select, using the SAME <MultiSelect/>
    // the Project modal uses for its member picker. It is not an <input>, so it
    // cannot be register()ed; the value is read/written through react-hook-form's
    // own watch/setValue rather than a second piece of local state, which keeps
    // zod validation and form.reset() working like every other field.
    if (f.type === 'multiselect') {
      const src = fieldOptions[f.name] || {}
      const selected = form.watch(f.name)
      return (
        <div key={f.name} className={cls}>
          <MultiSelect
            label={f.label}
            options={src.options || f.options || []}
            loading={src.loading}
            value={Array.isArray(selected) ? selected : []}
            onChange={(next) => form.setValue(f.name, next, { shouldValidate: true, shouldDirty: true })}
            placeholder={f.placeholder}
            emptyText={f.emptyText}
            error={err}
          />
          {f.hint && !err && <p className="mt-1.5 text-xs text-muted">{f.hint}</p>}
        </div>
      )
    }
    // Phase 6.6 (TASK 2): password support via the EXISTING PasswordField /
    // PasswordStrength pair. `f.strength` opts a field into the live meter;
    // `f.match` renders the confirm-password indicator against the named sibling.
    if (f.type === 'password') {
      const pw = f.strength ? (form.watch(f.name) || '') : ''
      const other = f.match ? (form.watch(f.match) || '') : ''
      const self = f.match ? (form.watch(f.name) || '') : ''
      const matches = self.length > 0 && self === other
      return (
        <div key={f.name} className={cls}>
          <PasswordField label={f.label} error={err} {...form.register(f.name)} />
          {f.strength && <PasswordStrength value={pw} />}
          {f.match && self.length > 0 && !err && (
            <p className={`mt-1.5 text-xs font-medium ${matches ? 'text-success' : 'text-danger'}`}>
              {matches ? 'Passwords match' : 'Passwords do not match'}
            </p>
          )}
        </div>
      )
    }
    return <Input key={f.name} label={f.label} type={f.type || 'text'} className={cls} placeholder={f.placeholder} error={err} {...form.register(f.name)} />
  })
}
