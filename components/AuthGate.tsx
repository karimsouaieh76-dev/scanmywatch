"use client";

import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { MAX_DEVICES } from "@/lib/limits";
import type { User } from "@supabase/supabase-js";

const DEVICE_ID_KEY = "luxscan_device_id";

type DeviceRow = {
  id: string;
  device_label: string | null;
  device_fingerprint: string;
  last_seen_at: string;
};

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function guessDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Dispositivo";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Dispositivo";
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [deviceLimitReached, setDeviceLimitReached] = useState(false);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [checkingDevice, setCheckingDevice] = useState(false);

  const [authMode, setAuthMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    registerDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function registerDevice() {
    if (!user) return;
    setCheckingDevice(true);
    const deviceId = getOrCreateDeviceId();

    const { data: existingDevices } = await supabase
      .from("devices")
      .select("id, device_label, device_fingerprint, last_seen_at")
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false });

    const list = existingDevices ?? [];
    const alreadyRegistered = list.find((d) => d.device_fingerprint === deviceId);

    if (alreadyRegistered) {
      await supabase
        .from("devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", alreadyRegistered.id);
      setDeviceLimitReached(false);
      setCheckingDevice(false);
      return;
    }

    if (list.length >= MAX_DEVICES) {
      setDevices(list);
      setDeviceLimitReached(true);
      setCheckingDevice(false);
      return;
    }

    await supabase.from("devices").insert({
      user_id: user.id,
      device_fingerprint: deviceId,
      device_label: guessDeviceLabel(),
    });
    setDeviceLimitReached(false);
    setCheckingDevice(false);
  }

  async function removeDevice(id: string) {
    await supabase.from("devices").delete().eq("id", id);
    registerDevice();
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  function friendlyAuthError(message: string): string {
    if (message.includes("Invalid login credentials")) {
      return "Email o password non corrette.";
    }
    if (message.includes("User already registered")) {
      return "Esiste già un account con questa email. Prova ad accedere.";
    }
    if (message.includes("Password should be at least")) {
      return "La password deve avere almeno 6 caratteri.";
    }
    return message;
  }

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormMessage(null);
    setFormLoading(true);

    try {
      if (authMode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        });
        if (error) throw error;
        setFormMessage("Ti abbiamo inviato un'email con il link per reimpostare la password.");
        return;
      }

      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (!data.session) {
          setFormMessage("Controlla la tua email per confermare l'account prima di accedere.");
        }
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setFormError(err instanceof Error ? friendlyAuthError(err.message) : "Errore imprevisto.");
    } finally {
      setFormLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (authLoading) {
    return (
      <div className="auth-screen">
        <div className="loader" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="ValuTime" className="brand-logo-large" />
          <p className="brand-subtitle">VALUTAZIONE OROLOGI</p>
          <p className="sub" style={{ margin: "14px 0 24px" }}>
            Accedi per identificare e valutare i tuoi orologi.
          </p>

          <ul className="auth-benefits">
            <li>Identificazione AI in pochi secondi</li>
            <li>Valutazione di mercato con fonti reali</li>
            <li>Storico delle tue scansioni</li>
          </ul>

          {authMode !== "forgot" && (
            <div className="auth-tabs">
              <button
                type="button"
                className={authMode === "signin" ? "active" : ""}
                onClick={() => { setAuthMode("signin"); setFormError(null); setFormMessage(null); }}
              >
                Accedi
              </button>
              <button
                type="button"
                className={authMode === "signup" ? "active" : ""}
                onClick={() => { setAuthMode("signup"); setFormError(null); setFormMessage(null); }}
              >
                Registrati
              </button>
            </div>
          )}

          <form className="auth-form" onSubmit={handleEmailSubmit}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="auth-input"
            />
            {authMode !== "forgot" && (
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="auth-input"
              />
            )}

            {formError && <p className="form-error">{formError}</p>}
            {formMessage && <p className="form-message">{formMessage}</p>}

            <button type="submit" className="primary" disabled={formLoading} style={{ width: "100%" }}>
              {formLoading
                ? "ATTENDI…"
                : authMode === "signin"
                ? "ACCEDI"
                : authMode === "signup"
                ? "CREA ACCOUNT"
                : "INVIA LINK DI RECUPERO"}
            </button>

            {authMode === "signin" && (
              <button
                type="button"
                className="link-btn"
                onClick={() => { setAuthMode("forgot"); setFormError(null); setFormMessage(null); }}
              >
                Password dimenticata?
              </button>
            )}
            {authMode === "forgot" && (
              <button
                type="button"
                className="link-btn"
                onClick={() => { setAuthMode("signin"); setFormError(null); setFormMessage(null); }}
              >
                ← Torna al login
              </button>
            )}
          </form>

          <div className="auth-divider"><span>oppure</span></div>

          <button className="google-btn" onClick={signInWithGoogle}>
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.19.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            Accedi con Google
          </button>
        </div>
      </div>
    );
  }

  if (checkingDevice) {
    return (
      <div className="auth-screen">
        <div className="loader" />
      </div>
    );
  }

  if (deviceLimitReached) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="ValuTime" className="brand-logo-large" style={{ marginBottom: 18 }} />
          <p className="eyebrow">LIMITE DISPOSITIVI RAGGIUNTO</p>
          <strong style={{ display: "block", fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 19, marginBottom: 10, color: "var(--sapphire-text)" }}>
            Puoi usare ValuTime su massimo {MAX_DEVICES} dispositivi
          </strong>
          <p className="sub" style={{ margin: "0 0 18px", fontSize: 14 }}>
            Rimuovi un dispositivo dalla lista per continuare da questo.
          </p>
          <div className="device-list">
            {devices.map((d) => (
              <div className="device-row" key={d.id}>
                <div>
                  <strong>{d.device_label ?? "Dispositivo"}</strong>
                  <span>Ultimo accesso: {new Date(d.last_seen_at).toLocaleDateString("it-IT")}</span>
                </div>
                <button className="chip-btn" onClick={() => removeDevice(d.id)}>
                  Rimuovi
                </button>
              </div>
            ))}
          </div>
          <button className="secondary" onClick={signOut} style={{ width: "100%", marginTop: 16 }}>
            ESCI
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="user-bar">
        <span>{user.email}</span>
        <Link href="/storico" className="chip-btn" style={{ textDecoration: "none" }}>
          Storico
        </Link>
        <button className="chip-btn" onClick={signOut}>Esci</button>
      </div>
      {children}
    </>
  );
}
