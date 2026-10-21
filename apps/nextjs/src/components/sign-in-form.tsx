'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { communityRequest, safeCommunityNext, type CommunitySession } from '@/lib/community-client';
import { CommunityNotice } from './community-shell';
import styles from './google-sign-in-button.module.css';

export function SignInForm({
  next,
  authError,
}: {
  next?: string;
  authError?: 'cancelled' | 'failed';
}) {
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [isFramed, setIsFramed] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const otpInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState(
    authError === 'cancelled'
      ? 'Google sign-in was cancelled. You can try again or continue as a guest.'
      : authError
        ? 'Google sign-in could not be completed. Please try again or choose another available option.'
        : '',
  );
  const [notice, setNotice] = useState('');
  const destination = safeCommunityNext(next);
  const guestDestination =
    destination.startsWith('/contribute') || destination.startsWith('/submissions/')
      ? destination
      : '/contribute';
  const emailAvailable = session?.signInMethods?.emailOtp ?? session?.authAvailable ?? false;
  const googleAvailable = session?.signInMethods?.google ?? false;
  const guestAction = (
    <Link
      className="community-secondary sign-in-guest"
      href={guestDestination}
      target={isFramed ? '_blank' : undefined}
      rel={isFramed ? 'noopener noreferrer' : undefined}
    >
      <span>
        {session?.user
          ? guestDestination.startsWith('/submissions/')
            ? 'Back to your contribution'
            : 'Share a story'
          : 'Continue as a guest'}
      </span>
      <ArrowRight size={17} aria-hidden="true" />
      {isFramed && <span className="sr-only"> (opens in a new tab)</span>}
    </Link>
  );

  const loadSession = useCallback(async () => {
    setLoadingSession(true);
    setSessionError('');
    try {
      setSession(await communityRequest<CommunitySession>('/session'));
    } catch {
      setSessionError('Sign-in options could not be loaded. Please try again.');
    } finally {
      setLoadingSession(false);
    }
  }, []);
  useEffect(() => {
    if (window.self !== window.top) {
      setIsFramed(true);
      setLoadingSession(false);
      return;
    }
    void loadSession();
  }, [loadSession]);
  useEffect(() => {
    if (phase === 'code' && busy === null) otpInput.current?.focus();
  }, [phase, busy]);

  async function authRequest(path: string, body: object): Promise<Record<string, unknown>> {
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    let result: Record<string, unknown>;
    try {
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      result = value as Record<string, unknown>;
    } catch {
      throw new Error('Sign-in could not be completed. Please try again.');
    }
    if (!response.ok)
      throw new Error(
        typeof result.message === 'string'
          ? result.message
          : 'Sign-in could not be completed. Please try again.',
      );
    return result;
  }

  async function startGoogle() {
    if (isFramed || !googleAvailable || busy) return;
    setError('');
    setNotice('');
    setBusy('google');
    let leaving = false;
    try {
      const result = await authRequest('sign-in/social', {
        provider: 'google',
        callbackURL: destination,
        errorCallbackURL: `/sign-in?next=${encodeURIComponent(destination)}`,
      });
      if (typeof result.url !== 'string') throw new Error();
      const redirect = new URL(result.url);
      if (
        redirect.protocol !== 'https:' ||
        redirect.hostname !== 'accounts.google.com' ||
        redirect.username ||
        redirect.password ||
        redirect.port
      )
        throw new Error();
      // A same-tab navigation retains private receipt tokens already in sessionStorage.
      window.location.assign(redirect.href);
      leaving = true;
    } catch {
      setError(
        'Google sign-in could not be started. Please try again or choose another available option.',
      );
    } finally {
      if (!leaving) setBusy(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isFramed || !emailAvailable || busy) return;
    setError('');
    setNotice('');
    setBusy('email');
    try {
      if (phase === 'email') {
        await authRequest('email-otp/send-verification-otp', {
          email: email.trim(),
          type: 'sign-in',
        });
        setPhase('code');
        setNotice(
          session?.mailMode === 'local'
            ? 'A test code was written to the developer’s private outbox. No email was sent.'
            : 'A sign-in code has been sent to your email. Enter it below.',
        );
      } else {
        await authRequest('sign-in/email-otp', {
          email: email.trim(),
          otp: otp.trim(),
          name: name.trim() || email.trim().split('@')[0],
        });
        window.location.assign(destination);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {isFramed ? (
        <CommunityNotice title="Continue in the full archive">
          <p>Open sign-in in a new tab to securely access your account.</p>
          <div className="community-actions">
            <Link
              className="community-primary"
              href={`/sign-in?next=${encodeURIComponent(destination)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open sign-in in a new tab <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </CommunityNotice>
      ) : loadingSession ? (
        <div className="community-loading" role="status">
          <LoaderCircle className="community-spinner" size={22} aria-hidden="true" /> Checking
          sign-in options…
        </div>
      ) : session?.user ? (
        <>
          <CommunityNotice kind="success" title="You are signed in">
            {session.user.email}
          </CommunityNotice>
          <Link className="community-primary" href={destination}>
            Continue <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </>
      ) : (
        <>
          {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
          {sessionError && (
            <>
              <CommunityNotice kind="error">{sessionError}</CommunityNotice>
              <button
                className="community-secondary"
                type="button"
                onClick={() => {
                  void loadSession();
                }}
              >
                Reload sign-in options
              </button>
            </>
          )}
          {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
          <div className="sign-in-choices" role="group" aria-label="Choose how to continue">
            {googleAvailable && (
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  void startGoogle();
                }}
                disabled={busy !== null}
                aria-busy={busy === 'google'}
                aria-label="Sign in with Google"
              >
                {/* Google's unmodified, pre-approved 4× artwork; scale both axes equally. */}
                <img
                  src="/images/google-sign-in-light.png"
                  width={216}
                  height={48}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              </button>
            )}
            {guestAction}
            {busy === 'google' && (
              <span className={styles.status} role="status">
                <LoaderCircle size={18} className="community-spinner" aria-hidden="true" />
                Opening Google…
              </span>
            )}
          </div>
          {emailAvailable && (
            <form className="community-fields" onSubmit={submit}>
              {googleAvailable && (
                <p className="community-hint" style={{ marginTop: 16 }}>
                  Or continue with an email code
                </p>
              )}
              <label className="community-field">
                <span>Email address</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  readOnly={phase === 'code'}
                  disabled={busy !== null}
                />
              </label>
              {phase === 'email' && (
                <label className="community-field">
                  <span>
                    Your name <span className="community-hint">(for your private account)</span>
                  </span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    maxLength={160}
                    disabled={busy !== null}
                  />
                </label>
              )}
              {phase === 'code' && (
                <label className="community-field">
                  <span>Email verification code</span>
                  <input
                    ref={otpInput}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value)}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    required
                    minLength={4}
                    maxLength={12}
                    disabled={busy !== null}
                  />
                  <small>
                    {session?.mailMode === 'local'
                      ? 'Use the most recent test code from the developer’s private outbox.'
                      : `Use the most recent code sent to ${email}.`}
                  </small>
                </label>
              )}
              <div className="community-actions">
                <button className="community-primary" disabled={busy !== null} type="submit">
                  {busy === 'email' ? (
                    <LoaderCircle size={17} className="community-spinner" aria-hidden="true" />
                  ) : (
                    <Mail size={17} aria-hidden="true" />
                  )}
                  {busy === 'email'
                    ? phase === 'email'
                      ? 'Sending a code…'
                      : 'Verifying…'
                    : phase === 'email'
                      ? session?.mailMode === 'local'
                        ? 'Get a test sign-in code'
                        : 'Email me a sign-in code'
                      : 'Verify and continue'}
                </button>
                {phase === 'code' && (
                  <button
                    className="community-text-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      setPhase('email');
                      setOtp('');
                      setNotice('');
                    }}
                  >
                    Use another email or request a new code
                  </button>
                )}
              </div>
            </form>
          )}
          {session && !emailAvailable && !googleAvailable && (
            <CommunityNotice title="Account sign-in is not configured">
              Guest contributions remain available when contribution storage is enabled. Keep the
              private receipt link you receive after submitting.
            </CommunityNotice>
          )}
        </>
      )}
      {(isFramed || loadingSession || session?.user) && (
        <div className="sign-in-choices">{guestAction}</div>
      )}
      {!session?.user && (
        <div className="community-aside-card">
          <ShieldCheck size={28} strokeWidth={1.3} aria-hidden="true" />
          <h2>A place for the stories you share.</h2>
          <p>
            Sign in to keep your contributions together, or contribute as a guest. Your account name
            and email stay private; each contribution has its own public credit.
          </p>
        </div>
      )}
    </>
  );
}
