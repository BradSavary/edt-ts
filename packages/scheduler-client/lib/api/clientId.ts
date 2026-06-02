/** Identifiant client persisté dans localStorage pour éviter la double soumission. */
export function getClientId(): string {
  const KEY = 'edt-client-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
