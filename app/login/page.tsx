import { redirect } from "next/navigation";
import { signInWithGoogle } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentEmployee } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/auth-rules";

export const metadata = { title: "Sign in · ShiftBoard" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(typeof params.next === "string" ? params.next : undefined);

  if (await getCurrentEmployee()) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">ShiftBoard</CardTitle>
          <CardDescription>Weekend monitoring shifts for Voicify. Sign in with your company Google account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {params.error ? (
            <p role="alert" className="text-sm text-destructive">
              Sign-in could not be started. Please try again.
            </p>
          ) : null}
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <Button type="submit" className="w-full">
              Sign in with Google
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
