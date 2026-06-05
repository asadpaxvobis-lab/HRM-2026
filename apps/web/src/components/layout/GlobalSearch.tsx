import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { flatNavItems } from '@/lib/navConfig'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function GlobalSearch() {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const allItems = useMemo(() => flatNavItems(hasPermission), [hasPermission])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return allItems.slice(0, 10)
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.to.toLowerCase().includes(q) ||
        (item.heading ?? '').toLowerCase().includes(q)
    )
  }, [allItems, query])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const go = (to: string) => {
    setOpen(false)
    setQuery('')
    navigate(to)
  }

  return (
    <div ref={rootRef} className="relative flex-1 max-w-md mx-2 hidden sm:block">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        placeholder="Search pages…"
        className="pl-9 h-9"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            setQuery('')
          }
          if (e.key === 'Enter' && results[0]) {
            e.preventDefault()
            go(results[0].to)
          }
        }}
      />
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border bg-popover shadow-md overflow-hidden">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No pages match your search.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {results.map((item) => (
                <li key={item.to}>
                  <button
                    type="button"
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors',
                      'flex flex-col gap-0.5'
                    )}
                    onClick={() => go(item.to)}
                  >
                    <span className="font-medium">{item.label}</span>
                    {item.heading && (
                      <span className="text-xs text-muted-foreground">{item.heading}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
