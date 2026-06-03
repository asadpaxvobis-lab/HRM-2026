import { useEffect, useState } from 'react'
import { RefreshCw, Loader2, Save, Settings2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { computeOtPayAmount, formatPkr } from '@/lib/overtimePay'
import { OT_TYPE_OPTIONS, defaultMultiplierForType, type OtTypeCode } from '@/lib/overtimeTypes'

type OT = {
  id: string
  ot_no: string
  employee_id: string
  ot_date: string
  planned_hours: number
  ot_type: string
  rate_multiplier: number
  amount: number | null
  source: string | null
  employees?: { full_name: string; employee_code: string }
}

type RowEdit = {
  ot_type: OtTypeCode
  rate_multiplier: number
}

export function OvertimeEditTypePage() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('overtime.approve') || hasPermission('overtime.config')
  const [rows, setRows] = useState<OT[]>([])
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [recalcBusy, setRecalcBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('overtime_requests')
      .select(
        'id, ot_no, employee_id, ot_date, planned_hours, ot_type, rate_multiplier, amount, source, employees(full_name, employee_code)'
      )
      .eq('status', 'PENDING')
      .order('ot_date', { ascending: false })
      .limit(300)

    if (error) {
      toast.error('Failed to load', { description: error.message })
      setLoading(false)
      return
    }

    const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
      ...(r as object),
      employees: Array.isArray(r.employees) ? (r.employees as unknown[])[0] : r.employees,
    })) as OT[]

    setRows(mapped)
    const next: Record<string, RowEdit> = {}
    for (const r of mapped) {
      const t = (OT_TYPE_OPTIONS.some((o) => o.value === r.ot_type) ? r.ot_type : 'NORMAL') as OtTypeCode
      next[r.id] = {
        ot_type: t,
        rate_multiplier: Number(r.rate_multiplier) || defaultMultiplierForType(t),
      }
    }
    setEdits(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const onTypeChange = (id: string, otType: OtTypeCode) => {
    setEdits((prev) => ({
      ...prev,
      [id]: {
        ot_type: otType,
        rate_multiplier: defaultMultiplierForType(otType),
      },
    }))
  }

  async function saveRow(ot: OT) {
    const edit = edits[ot.id]
    if (!edit) return
    setBusyId(ot.id)

    const pay = await computeOtPayAmount(
      supabase,
      ot.employee_id,
      ot.ot_date,
      Number(ot.planned_hours),
      edit.rate_multiplier
    )
    const hourly = pay.data?.hourly_rate ?? null
    const amount = pay.data?.request_amount ?? null

    const { error } = await supabase
      .from('overtime_requests')
      .update({
        ot_type: edit.ot_type,
        rate_multiplier: edit.rate_multiplier,
        hourly_rate: hourly && hourly > 0 ? hourly : null,
        amount: amount && amount > 0 ? amount : null,
      })
      .eq('id', ot.id)
      .eq('status', 'PENDING')

    setBusyId(null)
    if (error) {
      toast.error('Save failed', { description: error.message })
      return
    }

    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'overtime',
      entityId: ot.id,
      after: { ot_type: edit.ot_type, rate_multiplier: edit.rate_multiplier, amount },
    })
    toast.success(`${ot.ot_no} updated`)
    void load()
  }

  async function recalculateAll() {
    if (rows.length === 0) return
    setRecalcBusy(true)
    let ok = 0
    let fail = 0
    for (const ot of rows) {
      const edit = edits[ot.id] ?? {
        ot_type: (OT_TYPE_OPTIONS.some((o) => o.value === ot.ot_type) ? ot.ot_type : 'NORMAL') as OtTypeCode,
        rate_multiplier:
          Number(ot.rate_multiplier) ||
          defaultMultiplierForType(
            (OT_TYPE_OPTIONS.some((o) => o.value === ot.ot_type) ? ot.ot_type : 'NORMAL') as OtTypeCode
          ),
      }
      const mult =
        edit.ot_type === 'NORMAL' && edit.rate_multiplier >= 1.5 ? 1.0 : edit.rate_multiplier

      const pay = await computeOtPayAmount(
        supabase,
        ot.employee_id,
        ot.ot_date,
        Number(ot.planned_hours),
        mult
      )

      const hourly = pay.data?.hourly_rate ?? 0
      const amount = pay.data?.request_amount ?? 0

      if (hourly <= 0) {
        fail++
        continue
      }

      const { error } = await supabase
        .from('overtime_requests')
        .update({
          ot_type: edit.ot_type,
          rate_multiplier: mult,
          hourly_rate: hourly,
          amount: amount > 0 ? amount : null,
        })
        .eq('id', ot.id)
        .eq('status', 'PENDING')

      if (error) fail++
      else ok++
    }
    setRecalcBusy(false)
    if (ok > 0) toast.success(`Recalculated ${ok} pending row(s)`)
    if (fail > 0) toast.error(`${fail} row(s) skipped (no salary or RPC error)`)
    void load()
  }

  if (!canEdit) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        You need <code className="font-mono">overtime.approve</code> or{' '}
        <code className="font-mono">overtime.config</code> permission to change OT type.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overtime type & rate"
        description="Change OT type and rate multiplier on pending requests. Amount = basic ÷ (month days × 8 h) × OT hours × multiplier."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={recalcBusy || rows.length === 0}
              onClick={() => void recalculateAll()}
            >
              {recalcBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Recalculate all
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Pending overtime — edit type & multiplier
          </CardTitle>
          <CardDescription>
            New manual requests: use <strong>Overtime → Record overtime</strong>. This page is for editing
            existing <strong>PENDING</strong> rows before approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">No pending overtime to edit.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Employee</th>
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-right px-4 py-2">Hours</th>
                    <th className="text-left px-4 py-2 min-w-[180px]">OT type</th>
                    <th className="text-left px-4 py-2 w-28">Multiplier</th>
                    <th className="text-right px-4 py-2">Est. amount</th>
                    <th className="text-right px-4 py-2">Save</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const edit = edits[r.id]
                    if (!edit) return null
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.employees?.full_name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {r.employees?.employee_code} · {r.ot_no}
                            {r.source === 'attendance' && (
                              <Badge variant="secondary" className="ml-1 text-[9px]">
                                Auto
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">{r.ot_date}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{Number(r.planned_hours).toFixed(2)} h</td>
                        <td className="px-4 py-3">
                          <Label className="sr-only">OT type</Label>
                          <Select
                            value={edit.ot_type}
                            onChange={(e) => onTypeChange(r.id, e.target.value as OtTypeCode)}
                          >
                            {OT_TYPE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label} (×{o.multiplier})
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            step="0.1"
                            min={1}
                            value={edit.rate_multiplier}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [r.id]: { ...edit, rate_multiplier: +e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {r.amount != null ? formatPkr(Number(r.amount)) : '—'}
                          <div className="text-[10px]">updates on save</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" disabled={busyId === r.id} onClick={() => void saveRow(r)}>
                            {busyId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-sm">Default multipliers (reference)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          {OT_TYPE_OPTIONS.map((o) => (
            <div key={o.value}>
              <strong>{o.label}</strong> — ×{o.multiplier}
            </div>
          ))}
          <p className="pt-2 text-xs">Attendance auto-OT picks type from holiday / weekend / normal day.</p>
        </CardContent>
      </Card>
    </div>
  )
}
