import Link from "next/link";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <Link href="/" className="flex items-center gap-2 font-mono text-sm tracking-widest text-accent">
          <span className="inline-block size-2 rounded-full bg-accent" /> AIRPOOL
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted">{subtitle}</p>
      </div>
      {children}
    </main>
  );
}
