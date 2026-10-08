import { Discovery } from '@/components/public/discovery';

export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-4 pt-4">
        <h1 className="max-w-3xl text-6xl font-bold sm:text-7xl">Find your next bracket.</h1>
        <p className="max-w-xl text-lg text-muted">
          Follow live events as they happen, or enter your team in one that’s open for registration.
        </p>
      </header>
      <Discovery />
    </div>
  );
}
