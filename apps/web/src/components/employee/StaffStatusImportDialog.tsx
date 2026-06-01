import { useRef, useState } from 'react'
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { parseStaffStatusWorkbook } from '@/lib/staffStatusImport'
import { runStaffStatusImport } from '@/lib/runStaffStatusImport'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function StaffStatusImportDialog({ open, onOpenChange, onComplete }: Props) {
  const { appUser, hasPermission } = useAuth()
  const canSetSalary = hasPermission('payroll.salary') || hasPermission('payroll.config')
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rowCount, setRowCount] = useState(0)
  const [skippedSections, setSkippedSections] = useState(0)
  const [parsedRows, setParsedRows] = useState<ReturnType<typeof parseStaffStatusWorkbook>['rows'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const reset = () => {
    setFileName('')
    setRowCount(0)
    setSkippedSections(0)
    setParsedRows(null)
    setProgress({ done: 0, total: 0 })
    if (fileRef.current) fileRef.current.value = ''
  }

  const onFile = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      toast.error('Choose an Excel file (.xlsx)')
      return
    }
    const buffer = await file.arrayBuffer()
    const parsed = parseStaffStatusWorkbook(buffer)
    setFileName(file.name)
    setRowCount(parsed.rows.length)
    setSkippedSections(parsed.skipped)
    setParsedRows(parsed.rows)
    if (parsed.rows.length === 0) {
      toast.error('No employee rows found', {
        description: 'Expected "Staff Status Report" with header row (Device PIN, Name, CNIC, …).',
      })
    } else {
      toast.success(`Found ${parsed.rows.length} employees`, {
        description: parsed.skipped ? `${parsed.skipped} section/header rows skipped` : undefined,
      })
    }
  }

  const runImport = async () => {
    if (!appUser?.company_id || !appUser.id) return
    if (!parsedRows?.length) {
      toast.error('Load an Excel file first')
      return
    }
    setBusy(true)
    setProgress({ done: 0, total: parsedRows.length })
    try {
      const result = await runStaffStatusImport(parsedRows, {
        companyId: appUser.company_id,
        userId: appUser.id,
        canSetSalary,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      toast.success('Import finished', {
        description: `${result.created} new, ${result.updated} updated, ${result.duplicates} duplicates skipped, ${result.errors} errors`,
      })
      onComplete()
      onOpenChange(false)
      reset()
    } catch (e) {
      toast.error('Import failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          onOpenChange(v)
          if (!v) reset()
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Staff Status Report
          </DialogTitle>
          <DialogDescription>
            Imports profile, compensation, statutory, and documents. Existing employees are updated (never duplicated).
            Repeated rows in the same file are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
            />
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" />
              {fileName || 'Choose Staff_Status_Report.xlsx'}
            </Button>
          </div>

          {rowCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {rowCount} employees ready
              {skippedSections > 0 ? ` · ${skippedSections} section rows skipped` : ''}
              {!canSetSalary ? ' · Salary import requires payroll permission' : ''}
            </p>
          )}

          {busy && progress.total > 0 && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing {progress.done} / {progress.total}…
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !parsedRows?.length} onClick={() => void runImport()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Import {rowCount > 0 ? rowCount : ''} employees
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
