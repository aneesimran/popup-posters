import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-24 max-w-xs">
      <h1 className="mb-1 text-2xl font-semibold">Popup Posters</h1>
      <p className="mb-6 text-sm text-muted">Enter your passcode.</p>
      <LoginForm />
    </main>
  );
}
