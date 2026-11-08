import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Not authorised · ShiftBoard" };

const MESSAGES: Record<string, string> = {
  domain: "That Google account is not on an allowed company domain. Sign in with your work account.",
  roster:
    "Your work account is not on the shift roster (or has been deactivated). Ask a supervisor to add you.",
  linked: "This employee record is already linked to a different Google account. Ask a supervisor for help.",
  oauth: "Sign-in did not complete. Please try again.",
};

export default async function NotAuthorisedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { reason } = await searchParams;
  const message = (typeof reason === "string" && MESSAGES[reason]) || MESSAGES.oauth;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Not authorised</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm underline underline-offset-4">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
