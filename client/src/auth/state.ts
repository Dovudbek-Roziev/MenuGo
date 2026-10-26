import { AuthApiError, fetchCsrfToken, fetchMe, loginRequest, logoutRequest, type AuthIdentity } from "./api";

export type AuthState =
  | { status: "checking" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; identity: AuthIdentity; recheckError?: string }
  | { status: "unavailable"; message: string };

let state: AuthState = { status: "checking" };
let csrfToken: string | undefined;
let generation = 0;
let checkPromise: Promise<void> | undefined;
const listeners = new Set<() => void>();

export function getAuthState(): AuthState { return state; }

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: AuthState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function checkSession(force = false): Promise<void> {
  if (checkPromise) return checkPromise;
  if (!force && state.status !== "checking") return Promise.resolve();
  const requestGeneration = ++generation;
  const backgroundRecheck = state.status === "authenticated";
  if (!backgroundRecheck) publish({ status: "checking" });
  const pending = fetchMe().then((identity) => {
    if (generation === requestGeneration) publish({ status: "authenticated", identity });
  }).catch((error: unknown) => {
    if (generation !== requestGeneration) return;
    if (error instanceof AuthApiError && error.status === 401) {
      csrfToken = undefined;
      publish({ status: "unauthenticated" });
    } else {
      if (backgroundRecheck && state.status === "authenticated") {
        publish({ ...state, recheckError: messageFor(error) });
      } else {
        publish({ status: "unavailable", message: messageFor(error) });
      }
    }
  }).finally(() => {
    if (checkPromise === pending) checkPromise = undefined;
  });
  checkPromise = pending;
  return pending;
}

export async function refreshCsrf(): Promise<void> {
  const token = await fetchCsrfToken();
  csrfToken = token;
}

export async function getSessionCsrfToken(): Promise<string> {
  if (!csrfToken) await refreshCsrf();
  return csrfToken!;
}

export function expireSession(): void {
  generation += 1;
  checkPromise = undefined;
  csrfToken = undefined;
  publish({ status: "unauthenticated" });
}

export async function signIn(email: string, password: string): Promise<void> {
  // Invalidate any earlier /me request without changing the route's auth state.
  // Keeping the current state prevents Router from unmounting LoginPage while
  // its form request is pending, preserving the entered email and local state.
  const requestGeneration = ++generation;
  try {
    csrfToken = await fetchCsrfToken();
    const result = await loginRequest(email, password, csrfToken);
    if (generation !== requestGeneration) return;
    csrfToken = result.csrfToken;
    publish({ status: "authenticated", identity: result.identity });
  } catch (error) {
    if (generation === requestGeneration) publish({ status: "unauthenticated" });
    throw error;
  }
}

export async function signOut(): Promise<void> {
  if (state.status !== "authenticated") return;
  const requestGeneration = ++generation;
  const current = state;
  try {
    if (!csrfToken) csrfToken = await fetchCsrfToken();
    try {
      await logoutRequest(csrfToken);
    } catch (error) {
      if (!(error instanceof AuthApiError) || error.code !== "CSRF_INVALID") throw error;
      csrfToken = await fetchCsrfToken();
      await logoutRequest(csrfToken);
    }
    if (generation !== requestGeneration) return;
    csrfToken = undefined;
    publish({ status: "unauthenticated" });
  } catch (error) {
    if (generation === requestGeneration) publish(current);
    throw error;
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "Сервис временно недоступен. Попробуйте ещё раз.";
}
