import { getSupabase } from './supabaseClient.js';
import { toast } from './utils.js';

const NETWORK_ERROR_HINT =
  "Can't reach Supabase — check your internet connection, and try disabling ad-blockers or an incognito window.";

function isNetworkError(err) {
  if (!err) return false;
  const name = err.name || '';
  const msg = String(err.message || '').toLowerCase();
  if (name === 'AuthRetryableFetchError' || name === 'TypeError') return true;
  return /failed to fetch|fetch failed|network request failed|network error|load failed/.test(msg);
}

function authErrorMessage(err, fallback) {
  return isNetworkError(err) ? NETWORK_ERROR_HINT : err.message || fallback;
}

export async function getSession() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(callback) {
  const supabase = getSupabase();
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function signUp(email, password, fullName) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
}

export async function sendPasswordReset(email) {
  const supabase = getSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const supabase = getSupabase();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function signOut() {
  const supabase = getSupabase();
  await supabase.auth.signOut();
}

export function wireAuthForms({ onAuthed }) {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const forgotForm = document.getElementById('forgot-form');
  const googleBtn = document.getElementById('google-signin-btn');

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const { session } = await signIn(email, password);
      onAuthed(session);
    } catch (err) {
      toast(authErrorMessage(err, 'Sign in failed'));
    }
  });

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    try {
      await signUp(email, password, name);
      toast('Check your email to confirm your account.');
    } catch (err) {
      toast(authErrorMessage(err, 'Sign up failed'));
    }
  });

  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    try {
      await sendPasswordReset(email);
      toast('Password reset email sent.');
    } catch (err) {
      toast(authErrorMessage(err, 'Could not send reset email'));
    }
  });

  googleBtn?.addEventListener('click', async () => {
    if (!googleBtn) return;
    const originalText = googleBtn.textContent;
    const originalDisabled = googleBtn.disabled;
    // Loading state + prevent duplicate OAuth requests
    googleBtn.disabled = true;
    googleBtn.textContent = 'Connecting to Google...';
    googleBtn.setAttribute('aria-busy', 'true');
    try {
      await signInWithGoogle();
      // On success, browser will redirect to Google; no need to restore button
      // If redirect does not happen (e.g., popup blocked), restore after timeout
      setTimeout(() => {
        if (document.contains(googleBtn) && googleBtn.disabled) {
          googleBtn.disabled = originalDisabled;
          googleBtn.textContent = originalText;
          googleBtn.removeAttribute('aria-busy');
        }
      }, 8000);
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      let friendly = authErrorMessage(err, 'Google sign-in failed. Please try again.');
      // OAuth provider not configured — give actionable Supabase Dashboard guidance
      if (msg.includes('provider not enabled') || msg.includes('unsupported provider') || msg.includes('validation failed')) {
        friendly = 'Google sign-in is not configured. Please enable Google provider in Supabase Dashboard → Authentication → Providers.';
        console.error('Supabase Google provider not enabled. Configure in Dashboard → Auth → Providers → Google');
      } else if (msg.includes('not configured')) {
        friendly = 'Google sign-in is not configured. Please enable Google provider in Supabase Dashboard → Authentication → Providers.';
      }
      toast(friendly);
      // Restore button on error (do not expose secrets / internal details to user, but log for dev)
      console.error('Google sign-in failed', err);
      googleBtn.disabled = originalDisabled;
      googleBtn.textContent = originalText;
      googleBtn.removeAttribute('aria-busy');
    }
  });
}
