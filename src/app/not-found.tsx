import Link from "next/link";

export default function NotFound() {
  return (
    <div className="pt-10">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-[13px] text-muted">
        This page or system does not exist.{" "}
        <Link href="/systems" className="text-accent hover:underline">
          Browse systems
        </Link>
      </p>
    </div>
  );
}
