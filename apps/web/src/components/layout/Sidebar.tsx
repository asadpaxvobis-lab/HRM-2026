import { NavLink, useNavigate } from 'react-router-dom'
import { Plus, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { navSections, quickAddActions } from '@/lib/navConfig'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function Sidebar() {
  const { hasPermission, appUser, signOut } = useAuth()
  const navigate = useNavigate()

  const availableActions = quickAddActions.filter((a) => !a.perm || hasPermission(a.perm))

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
          return (
            <div key={section.heading ?? `s-${sIdx}`} className="mb-3">
              {section.heading && (
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                  {section.heading}
                </div>
              )}
              <div>
                {visibleItems.map((item) => (
                  <NavLink
                    key={item.to}
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
