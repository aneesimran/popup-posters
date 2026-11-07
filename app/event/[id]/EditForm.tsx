"use client";

import { useActionState } from "react";
import { saveEvent } from "../../actions";
import type { EventRow } from "@/lib/types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}

export default function EditForm({ e }: { e: EventRow }) {
  const [error, action, pending] = useActionState(saveEvent.bind(null, e.id), null);
  return (
    <form action={action} className="space-y-3">
      <Field label="Title"><input name="title" defaultValue={e.title} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input name="start_date" type="date" defaultValue={e.start_date ?? ""} /></Field>
        <Field label="Until (optional)"><input name="end_date" type="date" defaultValue={e.end_date ?? ""} /></Field>
        <Field label="Start time"><input name="start_time" type="time" defaultValue={e.start_time ?? ""} /></Field>
        <Field label="End time"><input name="end_time" type="time" defaultValue={e.end_time ?? ""} /></Field>
      </div>
      <Field label="Venue"><input name="venue" defaultValue={e.venue ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Area"><input name="area" defaultValue={e.area ?? ""} /></Field>
        <Field label="Price"><input name="price" defaultValue={e.price ?? ""} /></Field>
      </div>
      <Field label="Description"><textarea name="description" rows={3} defaultValue={e.description ?? ""} /></Field>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
