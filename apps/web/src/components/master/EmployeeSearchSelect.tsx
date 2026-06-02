import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type EmployeeSearchOption = {
  id: string
  employee_code: string
  full_name: string
}

type EmployeeSearchSelectProps = {
  employees: EmployeeSearchOption[]
  value: string
  onChange: (employeeId: string) => void
  placeholder?: string
  listMaxHeightClass?: string
  disabled?: boolean
  resetKey?: string | number | boolean
}

export function EmployeeSearchSelect({
  employees,
  value,
  onChange,
  placeholder = 'Select employee',
  listMaxHeightClass = 'max-h-60',
  disabled = false,
  resetKey,
}: EmployeeSearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => employees.find((e) => e.id === value), [employees, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        `${e.employee_code} — ${e.full_name}`.toLowerCase().includes(q)
    )
  }, [employees, query])

  useEffect(() => {
    setQuery('')
    setOpen(false)
  }, [resetKey])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const triggerLabel = selected ? `${selected.employee_code} — ${selected.full_name}` : placeholder

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm text-left',
          'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          open && 'ring-2 ring-ring ring-offset-1',
          !selected && 'text-muted-foreground',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-[200] mt-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
          role="listbox"
          aria-label="Employees"
        >
          <div className="border-b bg-background p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or code…"
                className="h-9 pl-8 text-sm"
                autoComplete="off"
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          <div className={cn('overflow-y-auto', listMaxHeightClass)}>
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={cn(
                'w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent',
                !value && 'bg-accent/80'
              )}
              onClick={() => pick('')}
            >
              {placeholder}
            </button>

            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No matches.</p>
            ) : (
              filtered.map((e) => {
                const isSelected = value === e.id
                return (
                  <button
                    key={e.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm hover:bg-accent',
                      isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90'
                    )}
                    onClick={() => pick(e.id)}
                  >
                    {e.employee_code} — {e.full_name}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
