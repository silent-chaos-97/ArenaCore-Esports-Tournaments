import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col gap-6 pt-10">
      <h1 className="max-w-3xl text-6xl font-bold sm:text-7xl">
        From sign-ups to a champion, in one place.
      </h1>
      <p className="max-w-xl text-lg text-muted">
        Register your team, check in, report scores and follow the bracket live. Organizers run
        every match from a single console.
      </p>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded-md bg-cobalt px-4 py-2.5 font-semibold text-white hover:bg-cobalt-ink"
        >
          Create an account
        </Link>
        <Link
          href="/console"
          className="rounded-md border border-rule bg-surface px-4 py-2.5 font-semibold hover:border-muted"
        >
          Run a tournament
        </Link>
      </div>
    </div>
  );
}
