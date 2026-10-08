import 'server-only';

const BASE =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Server-side fetch of public read models; returns null on 404 so pages can render notFound(). */
export async function fetchPublic<T>(path: string, revalidateSeconds = 10): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate: revalidateSeconds } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Public API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}
