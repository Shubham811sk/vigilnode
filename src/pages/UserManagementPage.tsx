import React, { useCallback, useEffect, useState } from 'react';
import { useAuth, type UserRole } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, downloadAuthenticatedFile, formatRelativeTime, formatUtcTimestamp } from '../lib/api';

interface UserRecord {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  title: string;
  is_active: boolean;
  is_protected_root: boolean;
  last_login_at: string | null;
  created_at: string;
}

interface UsersResponse {
  items: UserRecord[];
  counts: { total: number; active: number; admins: number; maintainers: number };
}

interface AuditItem {
  id: number;
  created_at: string;
  user_email: string;
  user_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
}

export default function UserManagementPage() {
  const { user: currentUser, isAdmin } = useAuth();
  const { showToast, confirmAction } = useToast();

  const [data, setData] = useState<UsersResponse | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // Add / Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('READ_ONLY_MAINTAINER');
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Temporary password banner (replaces window.alert)
  const [issuedTempPass, setIssuedTempPass] = useState<{ email: string; temp: string } | null>(null);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams({ search, role: roleFilter, status: statusFilter });
      const [uRes, aRes] = await Promise.all([
        apiFetch<UsersResponse>(`/users?${qs.toString()}`),
        apiFetch<{ items: AuditItem[] }>('/audit-logs?limit=20'),
      ]);
      setData(uRes);
      setAuditLogs(aRes.items);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load user directory', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, showToast]);

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  const openAdd = () => {
    setEditingUser(null);
    setFullName('');
    setEmail('');
    setRole('READ_ONLY_MAINTAINER');
    setTitle('Read-Only Maintainer');
    setPassword('');
    setModalOpen(true);
  };

  const openEdit = (u: UserRecord) => {
    setEditingUser(u);
    setFullName(u.full_name);
    setEmail(u.email);
    setRole(u.role);
    setTitle(u.title);
    setPassword('');
    setModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingUser) {
        await apiFetch(`/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({ full_name: fullName.trim(), title: title.trim(), role }),
        });
        showToast(`Updated operator "${fullName}".`, 'success');
      } else {
        await apiFetch('/users', {
          method: 'POST',
          body: JSON.stringify({
            full_name: fullName.trim(),
            email: email.trim(),
            role,
            title: title.trim(),
            password,
          }),
        });
        showToast(`Created user "${email}" (${role}).`, 'success');
      }
      setModalOpen(false);
      await loadAll(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (u: UserRecord) => {
    try {
      await apiFetch(`/users/${u.id}/status`, { method: 'PATCH' });
      showToast(`${u.full_name} ${u.is_active ? 'deactivated' : 'activated'}.`, 'success');
      await loadAll(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Status update blocked', 'error');
    }
  };

  const handleResetPassword = async (u: UserRecord) => {
    const ok = await confirmAction({
      title: `Reset password for ${u.full_name}?`,
      message: `A new temporary password will be issued for ${u.email}.`,
      confirmLabel: 'Issue Temporary Password',
    });
    if (!ok) return;
    try {
      const res = await apiFetch<{ email: string; temporary_password: string }>(`/users/${u.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setIssuedTempPass({ email: res.email, temp: res.temporary_password });
      showToast(`Temporary password issued for ${res.email}.`, 'success');
      await loadAll(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Password reset failed', 'error');
    }
  };

  const handleDeleteUser = async (u: UserRecord) => {
    const ok = await confirmAction({
      title: `Delete ${u.full_name}?`,
      message: `This permanently deletes ${u.email} from VigilNode.`,
      confirmLabel: 'Delete User',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/users/${u.id}`, { method: 'DELETE' });
      showToast(`Deleted user ${u.email}.`, 'success');
      await loadAll(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete blocked', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff]">
            STRICT TWO-ROLE RBAC • ADMIN & READ_ONLY_MAINTAINER
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">User & Role Management</h1>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void downloadAuthenticatedFile('/audit-logs/export.csv', 'vigilnode-audit-logs.csv').catch((e) =>
                  showToast(e.message, 'error'),
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs text-[#d3e4fe]"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              <span>Export Audit CSV</span>
            </button>
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">person_add</span>
              <span>Add Operator</span>
            </button>
          </div>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Total Users</div>
          <div className="text-2xl font-semibold text-[#d3e4fe] tabular-nums mt-1">{data?.counts.total ?? 0}</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Active Accounts</div>
          <div className="text-2xl font-semibold text-[#4edea3] tabular-nums mt-1">{data?.counts.active ?? 0}</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Admins</div>
          <div className="text-2xl font-semibold text-[#adc6ff] tabular-nums mt-1">{data?.counts.admins ?? 0}</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Read-Only Maintainers</div>
          <div className="text-2xl font-semibold text-[#c2c6d6] tabular-nums mt-1">{data?.counts.maintainers ?? 0}</div>
        </div>
      </div>

      {issuedTempPass && (
        <div className="p-4 rounded-xl bg-[#00a572]/15 border border-[#4edea3]/50 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="font-mono">
            <span className="text-[#4edea3] font-semibold">Temporary Password Issued for {issuedTempPass.email}: </span>
            <code className="px-2 py-0.5 rounded bg-[#000f21] text-[#d3e4fe] select-all">{issuedTempPass.temp}</code>
          </div>
          <button
            type="button"
            onClick={() => setIssuedTempPass(null)}
            className="text-[#8c909f] hover:text-[#d3e4fe]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-3.5 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or title..."
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
        >
          <option value="ALL">All Roles</option>
          <option value="ADMIN">ADMIN</option>
          <option value="READ_ONLY_MAINTAINER">READ_ONLY_MAINTAINER</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by account status"
          className="px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
        >
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102034]/60 border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                <th className="p-3">Operator</th>
                <th className="p-3">Role</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last Login</th>
                {isAdmin && <th className="p-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1b2b3f]/60">
              {loading && !data ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center font-mono text-[#8c909f]">
                    Loading users...
                  </td>
                </tr>
              ) : (
                (data?.items || []).map((u) => (
                  <tr key={u.id} className="hover:bg-[#102034]/50">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#d3e4fe]">{u.full_name}</span>
                        {u.is_protected_root && (
                          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-[#4d8eff]/20 text-[#adc6ff]">
                            ROOT
                          </span>
                        )}
                        {currentUser?.id === u.id && (
                          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-[#00a572]/20 text-[#4edea3]">
                            YOU
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-[#8c909f]">
                        {u.email} • {u.title}
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                          u.role === 'ADMIN'
                            ? 'bg-[#00a572]/15 border-[#4edea3]/40 text-[#4edea3]'
                            : 'bg-[#4d8eff]/15 border-[#adc6ff]/30 text-[#adc6ff]'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                          u.is_active ? 'bg-[#00a572]/20 text-[#4edea3]' : 'bg-[#93000a]/50 text-[#ffb4ab]'
                        }`}
                      >
                        {u.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-[11px] text-[#8c909f]">
                      {u.last_login_at ? formatRelativeTime(u.last_login_at) : 'Never'}
                    </td>
                    {isAdmin && (
                      <td className="p-3 text-right whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="px-2.5 py-1 rounded bg-[#102034] hover:bg-[#1b2b3f] text-[#d3e4fe]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleResetPassword(u)}
                          className="px-2.5 py-1 rounded bg-[#102034] hover:bg-[#1b2b3f] text-[#adc6ff]"
                        >
                          Reset PW
                        </button>
                        <button
                          type="button"
                          disabled={u.is_protected_root || u.id === currentUser?.id}
                          onClick={() => void handleToggleStatus(u)}
                          className="px-2.5 py-1 rounded bg-[#102034] hover:bg-[#1b2b3f] disabled:opacity-35 text-amber-300"
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          disabled={u.is_protected_root || u.id === currentUser?.id}
                          onClick={() => void handleDeleteUser(u)}
                          className="px-2.5 py-1 rounded bg-[#102034] hover:bg-[#93000a]/60 disabled:opacity-35 text-[#ffb4ab]"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Trail */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1b2b3f] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#d3e4fe]">RBAC & Security Audit Log</h2>
          <span className="font-mono text-[11px] text-[#8c909f]">Latest 20 events</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102034]/60 border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                <th className="p-3">Time (UTC)</th>
                <th className="p-3">Operator</th>
                <th className="p-3">Action</th>
                <th className="p-3">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1b2b3f]/60">
              {auditLogs.map((a) => (
                <tr key={a.id} className="hover:bg-[#102034]/50">
                  <td className="p-3 font-mono text-[11px] text-[#8c909f]">{formatUtcTimestamp(a.created_at)}</td>
                  <td className="p-3 font-mono text-[#d3e4fe]">
                    {a.user_email} <span className="text-[#8c909f]">({a.user_role})</span>
                  </td>
                  <td className="p-3 font-mono text-[#4edea3]">{a.action}</td>
                  <td className="p-3 font-mono text-[#adc6ff]">
                    {a.resource_type} {a.resource_id ? `• ${a.resource_id}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b1c30] border border-[#26364a] rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#d3e4fe]">
                {editingUser ? `Edit ${editingUser.full_name}` : 'Add New Operator'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-[#8c909f]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="space-y-3">
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Full Name *</label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Role</label>
                  <select
                    value={role}
                    disabled={Boolean(editingUser?.is_protected_root)}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  >
                    <option value="ADMIN">ADMIN</option>
                    <option value="READ_ONLY_MAINTAINER">READ_ONLY_MAINTAINER</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Job Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                  />
                </div>
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Initial Password (min 8 chars) *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t border-[#1b2b3f]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-[#102034] text-xs text-[#c2c6d6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-[#4d8eff] text-[#00285d] text-xs font-semibold"
                >
                  {saving ? 'Saving...' : editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
