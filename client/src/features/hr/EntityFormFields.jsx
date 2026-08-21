import { PasswordField } from '@/features/admin/PasswordField'
import { PasswordStrength } from '@/features/admin/PasswordStrength'
import { Select, Input, Textarea, MultiSelect } from '@/components/ui'

export function EntityFormFields({ form, fields = [], editing, fieldOptions = {} }) {
  return fields.map((f) => {
    const err = form.formState.errors[f.name]?.message
    const cls = f.full ? 'sm:col-span-2' : ''
    if (f.createOnly && editing) return null
    if (f.type === 'select') {
      const src = fieldOptions[f.name]
      let opts = src ? (src.options || []) : f.options
      if (src) {
        const current = form.watch(f.name)
        const hasCurrent = (opts || []).some((o) => (o && typeof o === 'object' ? o.value : o) === current)
        if (current && !hasCurrent) opts = [{ value: current, label: current }, ...(opts || [])]
      }
      const registered = f.onSelect
        ? form.register(f.name, { onChange: (e) => f.onSelect(form, e.target.value) })
        : form.register(f.name)
      return (
        <Select
          key={f.name}
          label={f.label}
          className={cls}
          options={opts}
          loading={src?.loading}
          emptyText={f.emptyText}
          placeholder={f.placeholder}
          error={err}
          searchable={f.searchable}
          {...registered}
        />
      )
    }
    if (f.type === 'textarea') return <Textarea key={f.name} label={f.label} className={cls} error={err} {...form.register(f.name)} />
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
