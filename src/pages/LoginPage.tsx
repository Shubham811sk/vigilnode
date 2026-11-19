import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export default function LoginPage() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('shubham.bind@vigilnode.local');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      showToast('Authenticated to VigilNode Telemetry Portal.', 'success');
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError('');
  };

  return (
    <div className="min-h-screen bg-[#031427] text-[#d3e4fe] flex flex-col justify-between p-4 sm:p-8">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#4d8eff]/20 border border-[#adc6ff]/30 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" className="opacity-40" />
              <path d="M3 12h4l2.5-5 4 10 2.5-5H21" stroke="#4edea3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight text-[#d3e4fe]">VigilNode</div>
            <div className="font-mono text-[11px] text-[#adc6ff]">Automated Service Availability Telemetry</div>
          </div>
        </div>
        <Link
          to="/status"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs font-medium text-[#4edea3] transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">public</span>
          <span>Public Status Portal</span>
        </Link>
      </div>

      <div className="max-w-4xl w-full mx-auto my-8 grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
        {/* Left Identity Panel */}
        <div className="lg:col-span-2 bg-[#0b1c30] border border-[#1b2b3f] rounded-2xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#00a572]/15 border border-[#4edea3]/30 font-mono text-[11px] text-[#4edea3]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3] animate-pulse" />
              MULTI-PROTOCOL SRE ENGINE
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe]">
              Real-Time Infrastructure Observability & Incident Triage
            </h1>
            <p className="text-xs text-[#c2c6d6] leading-relaxed">
              Continuous synthetic probes across HTTP/HTTPS, TCP Sockets, Authoritative DNS, and X.509 SSL/TLS
              certificates with automated incident lifecycles and public status publishing.
            </p>
          </div>

          <div className="space-y-2.5 pt-4 border-t border-[#1b2b3f]">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#8c909f]">Demo Role Access</div>
            <button
              type="button"
              onClick={() => fillDemo('shubham.bind@vigilnode.local', 'Admin@1234')}
              className="w-full text-left p-2.5 rounded-xl bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#d3e4fe]">Shubham Bind</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#00a572]/20 text-[#4edea3]">ADMIN</span>
              </div>
              <div className="font-mono text-[11px] text-[#8c909f] mt-0.5">shubham.bind@vigilnode.local</div>
            </button>

            <button
              type="button"
              onClick={() => fillDemo('maintainer@vigilnode.local', 'Viewer@1234')}
              className="w-full text-left p-2.5 rounded-xl bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#d3e4fe]">Operations Viewer</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#4d8eff]/20 text-[#adc6ff]">
                  READ_ONLY_MAINTAINER
                </span>
              </div>
              <div className="font-mono text-[11px] text-[#8c909f] mt-0.5">maintainer@vigilnode.local</div>
            </button>
          </div>
        </div>

        {/* Right Sign-In Form */}
        <div className="lg:col-span-3 bg-[#0b1c30] border border-[#1b2b3f] rounded-2xl p-6 sm:p-8 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-[#d3e4fe]">Sign in to VigilNode</h2>
            <p className="text-xs text-[#8c909f] mt-1">
              Enter your operator credentials to access live telemetry, monitors, and incident management.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-[#93000a]/40 border border-[#ff5451]/60 flex items-start gap-2.5 text-xs text-[#ffb4ab]">
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-[#c2c6d6] mb-1.5">
                Operator Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@vigilnode.local"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#000f21] border border-[#26364a] focus:border-[#adc6ff] focus:outline-none text-sm text-[#d3e4fe] font-mono"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-[#c2c6d6] mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3.5 py-2.5 pr-11 rounded-xl bg-[#000f21] border border-[#26364a] focus:border-[#adc6ff] focus:outline-none text-sm text-[#d3e4fe] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8c909f] hover:text-[#d3e4fe] p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-[#4d8eff] hover:bg-[#adc6ff] disabled:opacity-50 text-[#00285d] font-semibold text-sm transition-colors flex items-center justify-center gap-2 min-h-[44px]"
            >
              <span className="material-symbols-outlined text-[18px]">login</span>
              <span>{submitting ? 'Authenticating...' : 'Sign In to Telemetry Console'}</span>
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-[#1b2b3f] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#8c909f]">
            <span>JWT Session • Bcrypt Protected</span>
            <span>Strict RBAC: ADMIN / READ_ONLY_MAINTAINER</span>
          </div>
        </div>
      </div>

      <footer className="max-w-5xl w-full mx-auto text-center font-mono text-[11px] text-[#8c909f]">
        VigilNode — MCA Capstone Project • Automated Multi-Protocol Service Availability Telemetry • Shubham Bind
      </footer>
    </div>
  );
}
