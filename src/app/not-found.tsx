import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">The page does not exist, or you do not have access to it.</p>
      <ButtonLink href="/">Go to my home page</ButtonLink>
    </main>
  );
}
