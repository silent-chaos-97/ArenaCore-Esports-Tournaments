import 'server-only';

const BASE =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * Server-side fetch of public read models; returns null on 404 so pages can render notFound().
 * Live tournament data is never cached by Next (the API caches it in Redis and invalidates it on
 * live events); pass `revalidateSeconds` only for slow-moving views such as leaderboards.
 */
export async function fetchPublic<T>(path: string, revalidateSeconds?: number): Promise<T | null> {
  const res = await fetch(
    `${BASE}${path}`,
    revalidateSeconds ? { next: { revalidate: revalidateSeconds } } : { cache: 'no-store' },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Public API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}
