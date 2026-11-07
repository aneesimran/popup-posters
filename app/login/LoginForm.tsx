"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3">
      <input name="passcode" type="password" autoComplete="current-password" placeholder="Passcode" autoFocus required />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Checking…" : "Open"}
      </button>
    </form>
  );
}
