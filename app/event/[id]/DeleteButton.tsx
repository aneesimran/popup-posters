"use client";

import { removeEvent } from "../../actions";

export default function DeleteButton({ id }: { id: number }) {
  return (
    <form
      action={removeEvent.bind(null, id)}
      onSubmit={(ev) => {
        if (!confirm("Delete this event?")) ev.preventDefault();
      }}
    >
      <button className="rounded-lg border border-line px-4 py-2 text-sm text-red-600 dark:text-red-400">Delete</button>
    </form>
  );
}
