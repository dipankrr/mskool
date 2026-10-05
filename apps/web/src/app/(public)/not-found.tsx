import Link from "next/link";

/**
 * Branded "site not found" for unknown/unpublished tenant sites (ADR-041
 * §5): an unknown slug must look like a friendly dead end, not an error,
 * and must never disclose whether the org exists.
 */
export default function PublicNotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#FBF6DC] px-6 text-center font-sans text-[#1E3A34]">
      <div className="max-w-md">
        <p className="text-6xl">🌱</p>
        <h1 className="mt-6 font-bold text-3xl text-[#155E4B]">
          This school&rsquo;s site isn&rsquo;t here yet
        </h1>
        <p className="mt-3 leading-relaxed text-[#1E3A34]/70">
          The address may be misspelled, or the school hasn&rsquo;t launched
          its site. Powered by mskool.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-full bg-[#E8542F] px-6 py-3 font-bold text-white transition-transform hover:-translate-y-0.5"
        >
          Go to mskool
        </Link>
      </div>
    </main>
  );
}
