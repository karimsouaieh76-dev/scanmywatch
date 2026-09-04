"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("La password deve avere almeno 6 caratteri.");
      return;
    }
    if (password !== confirm) {
      setError("Le due password non coincidono.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand" style={{ justifyContent: "center", display: "flex" }}>
          ValuTime
        </div>
        <p className="brand-subtitle">VALUTAZIONE OROLOGI</p>

        {done ? (
          <>
            <p className="sub" style={{ margin: "18px 0 6px" }}>
              Password aggiornata con successo.
            </p>
            <a href="/" className="primary" style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 16 }}>
              VAI ALL&apos;APP
            </a>
          </>
        ) : (
          <>
            <p className="sub" style={{ margin: "14px 0 24px" }}>
              Imposta una nuova password per il tuo account.
            </p>
            <form className="auth-form" onSubmit={handleSubmit}>
              <input
                type="password"
                placeholder="Nuova password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="auth-input"
              />
              <input
                type="password"
                placeholder="Conferma password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                className="auth-input"
              />
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="primary" disabled={loading} style={{ width: "100%" }}>
                {loading ? "ATTENDI…" : "SALVA NUOVA PASSWORD"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
