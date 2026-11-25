/** Require an authenticated session; mutating requests also verify CSRF/origin. */
export function requireSession(auth) {
  return (req, mutate = true) => auth.requireSession(req, mutate);
}
