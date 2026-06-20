import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, LogOut, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { navSections, quickAddActions, type NavItem } from '@/lib/navConfig'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function navItemMatchesPath(item: NavItem, pathname: string) {
  if (item.to === '/') return pathname === '/'
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

const sectionHeadingClass =
  'px-2 pt-3 pb-1.5 text-sm font-bold text-foreground/90'

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'block px-2 py-1.5 text-[13.5px] rounded-md transition-colors',
          isActive
            ? 'text-primary font-semibold bg-primary/5'
            : 'text-foreground/80 hover:text-foreground hover:bg-accent/60'
        )
      }
    >
      {item.label}
    </NavLink>
  )
}

export function Sidebar() {
  const { hasPermission, appUser, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const availableActions = quickAddActions.filter((a) => !a.perm || hasPermission(a.perm))

  useEffect(() => {
    navSections.forEach((section) => {
      if (!section.collapsible || !section.heading) return
      const visibleItems = section.items.filter((it) => !it.perm || hasPermission(it.perm))
      const collapsibleItems = visibleItems.filter((item) => !item.pinned)
      const hasActiveCollapsible = collapsibleItems.some((item) =>
        navItemMatchesPath(item, location.pathname)
      )
      if (hasActiveCollapsible) {
        setExpandedSections((prev) =>
          prev[section.heading!] ? prev : { ...prev, [section.heading!]: true }
        )
      }
    })
  }, [location.pathname, hasPermission])

  const toggleSection = (heading: string) => {
    setExpandedSections((prev) => ({ ...prev, [heading]: !prev[heading] }))
  }

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r bg-card h-screen sticky top-0">
      {/* Brand */}
      <NavLink
        to="/"
        end
        className="px-5 pt-5 pb-3 block hover:opacity-80 transition-opacity"
        aria-label="Go to dashboard"
      >
        <h1 className="text-xl font-bold tracking-tight">HRM ERP 2026</h1>
      </NavLink>

      {/* Quick add */}
      {availableActions.length > 0 && (
        <div className="px-4 pb-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex items-center justify-center gap-2 rounded-full bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm py-2.5 transition-colors shadow-sm"
                type="button"
              >
                <Plus className="h-4 w-4" /> New
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-[60vh] overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Quick create</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableActions.map((a) => (
                <DropdownMenuItem key={a.label} onClick={() => navigate(a.to)}>
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-4 pb-4">
        {navSections.map((section, sIdx) => {
          const visibleItems = section.items.filter((it) => !it.perm || hasPermission(it.perm))
          if (visibleItems.length === 0) return null

          const sectionKey = section.heading ?? `s-${sIdx}`
          const isCollapsible = Boolean(section.collapsible && section.heading)
          const pinnedItems = isCollapsible ? visibleItems.filter((item) => item.pinned) : []
          const collapsibleItems = isCollapsible
            ? visibleItems.filter((item) => !item.pinned)
            : visibleItems
          const isExpanded = section.heading ? Boolean(expandedSections[section.heading]) : false
          const hasCollapsibleItems = collapsibleItems.length > 0
          const showCollapsibleItems = !isCollapsible || !hasCollapsibleItems || isExpanded

          return (
            <div key={sectionKey} className="mb-3">
              {section.heading &&
                (isCollapsible && hasCollapsibleItems ? (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.heading!)}
                    className={cn(
                      sectionHeadingClass,
                      'flex w-full items-center gap-1.5 text-left hover:text-foreground transition-colors'
                    )}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    )}
                    <span>{section.heading}</span>
                  </button>
                ) : (
                  <div className={sectionHeadingClass}>{section.heading}</div>
                ))}

              <div>
                {pinnedItems.map((item) => (
                  <NavItemLink key={item.to} item={item} />
                ))}
                {showCollapsibleItems &&
                  collapsibleItems.map((item) => (
                    <NavItemLink key={item.to} item={item} />
                  ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Footer: email + logout */}
      <div className="border-t px-5 py-3 text-sm">
        <div className="text-muted-foreground text-[13px] truncate">{appUser?.email}</div>
        <button
          type="button"
          onClick={async () => {
            await signOut()
            navigate('/login')
          }}
          className="mt-1 flex items-center gap-1.5 text-[13.5px] text-foreground/80 hover:text-destructive transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" /> Logout
        </button>
      </div>
    </aside>
  )
}
