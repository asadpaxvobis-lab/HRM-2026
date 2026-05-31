import { useEffect, useState } from 'react'
import { Plus, RefreshCw, KeyRound, ShieldOff, ShieldCheck, Loader2, Search, UserPlus, AlertCircle, Trash2, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { HasPermission } from '@/components/HasPermission'
import { avatarColorFor, initialsFromName, formatRelative } from '@/lib/utils'
import { toast } from 'sonner'
import { createUserViaAdmin } from '@/lib/createUser'
import { deleteUserViaAdmin } from '@/lib/deleteUser'
import { updateUserViaAdmin } from '@/lib/updateUser'
import { resetUserPasswordViaAdmin } from '@/lib/resetUserPassword'
import { writeAuditLog } from '@/lib/audit'
import { Select } from '@/components/ui/select'

type UserRow = {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  status: 'Active' | 'Disabled' | 'Pending'
  force_password_change: boolean
  last_login_at: string | null
  created_at: string
  roles: { id: string; name: string }[]
}

type RoleOption = { id: string; name: string; description: string | null }

export function UsersPage() {
  const { hasPermission, appUser } = useAuth()
  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)

  async function load() {
    setLoading(true)
    const [usersRes, rolesRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, email, full_name, phone, status, force_password_change, last_login_at, created_at, user_roles!user_id(roles(id,name))')
        .order('created_at', { ascending: false }),
      supabase.from('roles').select('id, name, description').order('name'),
    ])

    if (usersRes.error) toast.error('Failed to load users', { description: usersRes.error.message })
    if (rolesRes.error) toast.error('Failed to load roles', { description: rolesRes.error.message })

    const mapped: UserRow[] = (usersRes.data ?? []).map((u: any) => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      phone: u.phone,
      status: u.status,
      force_password_change: u.force_password_change,
      last_login_at: u.last_login_at,
      created_at: u.created_at,
      roles: (u.user_roles ?? [])
        .map((ur: any) => ur.roles)
        .filter(Boolean)
        .map((r: any) => ({ id: r.id, name: r.name })),
    }))
    setUsers(mapped)
    setRoles((rolesRes.data ?? []) as RoleOption[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = users.filter((u) => {
    const q = query.toLowerCase().trim()
    if (!q) return true
    return (
      u.email.toLowerCase().includes(q) ||
      (u.full_name ?? '').toLowerCase().includes(q) ||
      u.roles.some((r) => r.name.toLowerCase().includes(q))
    )
  })

  const toggleStatus = async (user: UserRow) => {
    const next = user.status === 'Active' ? 'Disabled' : 'Active'
    const { error } = await supabase.from('users').update({ status: next }).eq('id', user.id)
    if (error) {
      toast.error('Could not update status', { description: error.message })
      return
    }
    await writeAuditLog({
      action: next === 'Active' ? 'ENABLE' : 'DISABLE',
      entityType: 'user',
      entityId: user.id,
    })
    toast.success(`User ${next === 'Active' ? 'enabled' : 'disabled'}`)
    void load()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
          <p className="text-sm text-muted-foreground">
            People who can log in to the system. Employees are managed separately under People.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <HasPermission perm="user.create">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create user
            </Button>
          </HasPermission>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">All users</CardTitle>
            <CardDescription>{filtered.length} of {users.length}</CardDescription>
          </div>
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, role…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} canCreate={hasPermission('user.create')} />
          ) : (
            <div className="divide-y">
              {filtered.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className={avatarColorFor(u.email)}>{initialsFromName(u.full_name || u.email)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{u.full_name || '—'}</span>
                      {u.status !== 'Active' && (
                        <Badge variant={u.status === 'Disabled' ? 'destructive' : 'secondary'}>{u.status}</Badge>
                      )}
                      {u.force_password_change && (
                        <Badge variant="warm" title="Must change password on next login">
                          <AlertCircle className="h-3 w-3 mr-1" /> Pwd reset required
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="flex flex-wrap gap-1 min-w-[200px]">
                    {u.roles.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">No roles</span>
                    ) : (
                      u.roles.map((r) => (
                        <Badge key={r.id} variant="secondary">
                          {r.name}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground min-w-[120px]">
                    {u.last_login_at ? `Last login ${formatRelative(u.last_login_at)}` : 'Never logged in'}
                  </div>
                  <div className="flex items-center gap-1">
                    <HasPermission perm="user.update">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit user"
                        onClick={() => setEditTarget(u)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={u.status === 'Active' ? 'Disable user' : 'Enable user'}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.status === 'Active' ? (
                          <ShieldOff className="h-4 w-4" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                      </Button>
                    </HasPermission>
                    <HasPermission perm="user.reset_password">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Reset password"
                        onClick={() => setEditTarget(u)}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                    </HasPermission>
                    <HasPermission perm="user.delete">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Delete user"
                        className="text-destructive hover:text-destructive"
                        disabled={appUser?.id === u.id}
                        onClick={() => setDeleteTarget(u)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </HasPermission>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={roles}
        onCreated={() => void load()}
      />

      <EditUserDialog
        user={editTarget}
        roles={roles}
        onOpenChange={(open) => !open && setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null)
          void load()
        }}
      />

      <DeleteUserDialog
        user={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null)
          void load()
        }}
      />
    </div>
  )
}

function EmptyState({ onCreate, canCreate }: { onCreate: () => void; canCreate: boolean }) {
  return (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto h-12 w-12 rounded-full bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400 grid place-items-center mb-4">
        <UserPlus className="h-6 w-6" />
      </div>
      <h3 className="text-base font-medium mb-1">No users match</h3>
      <p className="text-sm text-muted-foreground mb-4">Try a different search, or create the first one.</p>
      {canCreate && (
        <Button size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4" /> Create user
        </Button>
      )}
    </div>
  )
}

function DeleteUserDialog({
  user,
  onOpenChange,
  onDeleted,
}: {
  user: UserRow | null
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)

  const label = user ? (user.full_name?.trim() || user.email) : ''
  const open = user !== null

  const onConfirm = async () => {
    if (!user) return
    setBusy(true)
    try {
      const { error } = await deleteUserViaAdmin(user.id)
      if (error) {
        toast.error('Could not delete user', { description: error })
        return
      }
      await writeAuditLog({ action: 'DELETE', entityType: 'user', entityId: user.id })
      toast.success('User deleted')
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete user?</DialogTitle>
          <DialogDescription>
            This will permanently remove <span className="font-medium text-foreground">{label}</span> (
            {user?.email}). They will no longer be able to sign in. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void onConfirm()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateUserDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  roles: RoleOption[]
  onCreated: () => void
}) {
  const { appUser } = useAuth()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [tempPassword, setTempPassword] = useState('changeme123')
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setEmail(''); setFullName(''); setPhone(''); setTempPassword('changeme123'); setSelectedRoles(new Set())
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    if (selectedRoles.size === 0) {
      toast.error('Select at least one role')
      return
    }
    setBusy(true)
    try {
      const roleIds = Array.from(selectedRoles)
      const result = await createUserViaAdmin({
        email,
        password: tempPassword,
        full_name: fullName,
        phone,
        role_ids: roleIds,
      })

      if (result.error || !result.user_id) {
        toast.error('Could not create user', { description: result.error ?? 'Unknown error' })
        return
      }

      await writeAuditLog({ action: 'CREATE', entityType: 'user', entityId: result.user_id })
      toast.success('User created', { description: `${email.trim()} can sign in with the temporary password.` })
      reset()
      onOpenChange(false)
      onCreated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            They'll sign in with the password you set below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="full_name">Full name</Label>
              <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="temp_pwd">Temporary password</Label>
              <Input
                id="temp_pwd"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                minLength={6}
                required
              />
              <p className="text-xs text-muted-foreground">Min 6 chars. User can sign in with this password immediately.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Roles</Label>
            <div className="grid sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-lg border p-3 bg-muted/20">
              {roles.map((r) => {
                const checked = selectedRoles.has(r.id)
                return (
                  <label
                    key={r.id}
                    className="flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-background transition-colors"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        const next = new Set(selectedRoles)
                        if (v) next.add(r.id)
                        else next.delete(r.id)
                        setSelectedRoles(next)
                      }}
                      className="mt-0.5"
                    />
                    <div className="leading-tight">
                      <div className="text-sm font-medium">{r.name}</div>
                      {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({
  user,
  roles,
  onOpenChange,
  onSaved,
}: {
  user: UserRow | null
  roles: RoleOption[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { appUser, hasPermission } = useAuth()
  const canResetPassword = hasPermission('user.reset_password')
  const isSelf = user?.id === appUser?.id
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<UserRow['status']>('Active')
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set())
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    setFullName(user.full_name ?? '')
    setPhone(user.phone ?? '')
    setStatus(user.status)
    setSelectedRoles(new Set(user.roles.map((r) => r.id)))
    setNewPassword('')
  }, [user])

  const open = user !== null

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!isSelf && selectedRoles.size === 0) {
      toast.error('Select at least one role')
      return
    }
    if (canResetPassword && newPassword.length > 0 && newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setBusy(true)
    try {
      const { error } = await updateUserViaAdmin({
        user_id: user.id,
        full_name: fullName,
        phone,
        status,
        role_ids: isSelf ? undefined : Array.from(selectedRoles),
      })
      if (error) {
        toast.error('Could not update user', { description: error })
        return
      }

      if (canResetPassword && newPassword.length >= 6) {
        const reset = await resetUserPasswordViaAdmin(user.id, newPassword)
        if (reset.error) {
          toast.error('Profile saved but password reset failed', { description: reset.error })
          return
        }
        await writeAuditLog({
          action: 'UPDATE',
          entityType: 'user',
          entityId: user.id,
          after: { password_reset: true },
        })
        toast.success('User updated and password reset', {
          description: `${user.email} can sign in with the new password.`,
        })
        setNewPassword('')
        onSaved()
        return
      }

      await writeAuditLog({
        action: 'UPDATE',
        entityType: 'user',
        entityId: user.id,
        after: { full_name: fullName, phone, status, roles: Array.from(selectedRoles) },
      })
      toast.success('User updated')
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  const onResetPassword = async () => {
    if (!user || !canResetPassword) return
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setResetBusy(true)
    try {
      const { error } = await resetUserPasswordViaAdmin(user.id, newPassword)
      if (error) {
        toast.error('Could not reset password', { description: error })
        return
      }
      await writeAuditLog({
        action: 'UPDATE',
        entityType: 'user',
        entityId: user.id,
        after: { password_reset: true },
      })
      toast.success('Password reset', {
        description: `${user.email} can sign in with the new password.`,
      })
      setNewPassword('')
      onSaved()
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>
            Update profile and roles. Administrators can set a new temporary password below.
          </DialogDescription>
        </DialogHeader>
        {user && (
          <form onSubmit={onSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit_email">Email</Label>
              <Input id="edit_email" value={user.email} readOnly disabled className="bg-muted/50" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit_full_name">Full name</Label>
                <Input
                  id="edit_full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_phone">Phone</Label>
                <Input id="edit_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit_status">Status</Label>
                <Select
                  id="edit_status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as UserRow['status'])}
                  disabled={isSelf}
                >
                  <option value="Active">Active</option>
                  <option value="Disabled">Disabled</option>
                  <option value="Pending">Pending</option>
                </Select>
                {isSelf && (
                  <p className="text-xs text-muted-foreground">You cannot change your own account status.</p>
                )}
              </div>
            </div>

            {!isSelf && (
              <div className="space-y-2">
                <Label>Roles</Label>
                <div className="grid sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-lg border p-3 bg-muted/20">
                  {roles.map((r) => {
                    const checked = selectedRoles.has(r.id)
                    return (
                      <label
                        key={r.id}
                        className="flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-background transition-colors"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            const next = new Set(selectedRoles)
                            if (v) next.add(r.id)
                            else next.delete(r.id)
                            setSelectedRoles(next)
                          }}
                          className="mt-0.5"
                        />
                        <div className="leading-tight">
                          <div className="text-sm font-medium">{r.name}</div>
                          {r.description && (
                            <div className="text-xs text-muted-foreground">{r.description}</div>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {canResetPassword && (
              <div className="space-y-3 rounded-lg border border-orange-200/80 bg-orange-50/50 p-4 dark:border-orange-900/50 dark:bg-orange-950/20">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    <KeyRound className="h-4 w-4" />
                    Reset password (administrator)
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter a new password and click <span className="font-medium">Set new password</span> or{' '}
                    <span className="font-medium">Save changes</span>. The user can sign in with it immediately.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit_new_password">New password</Label>
                  <Input
                    id="edit_new_password"
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                    placeholder="Min 6 characters"
                    autoComplete="new-password"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={resetBusy || newPassword.length < 6}
                  onClick={() => void onResetPassword()}
                >
                  {resetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Set new password
                </Button>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
