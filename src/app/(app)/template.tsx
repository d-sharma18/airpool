/** Re-mounts on every navigation, giving each page a short fade-and-rise entrance. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-[page-in_220ms_ease-out]">{children}</div>;
}
