import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2 } from 'lucide-react'

export function ProtectedRoute({ children, perm }: { children: ReactNode; perm?: string }) {
  const { session, loading, hasPermission } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (perm && !hasPermission(perm)) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-center px-6">
        <div>
          <div className="text-base font-medium mb-1">You don't have access to this page</div>
          <p className="text-sm text-muted-foreground">Ask your administrator to grant the <code className="text-foreground">{perm}</code> permission.</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
