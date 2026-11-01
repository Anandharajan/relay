import { useState } from "react";
import { api } from "../../lib/api";
export function AddClient({
  open,
  disabled,
  act,
  created,
}: {
  open: boolean;
  disabled: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  created: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("client");
  return (
    <details className="vd-add-client" open={open}>
      <summary>Add a client</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            const c = await api("/api/voice/clients", {
              body: { name, kind },
            });
            await created(c.id);
            setName("");
          });
        }}
      >
        <label>
          Name
          <input
            required
            maxLength={100}
            value={name}
            placeholder="e.g. Northside team"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Client type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {["client", "student", "patient", "employee", "customer"].map(
              (k) => (
                <option key={k}>{k}</option>
              ),
            )}
          </select>
        </label>
        <button className="btn" disabled={disabled}>
          Create workspace
        </button>
      </form>
    </details>
  );
}
