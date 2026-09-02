"use client";

import { useEffect, useState, type ReactNode } from "react";
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
          <div className="brand">LUX<span>SCAN</span><small>AI</small></div>
          <p className="sub" style={{ margin: "18px 0 26px" }}>
            Accedi per identificare e valutare i tuoi orologi.
          </p>
          <button className="primary" onClick={signInWithGoogle} style={{ width: "100%" }}>
            ACCEDI CON GOOGLE
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
          <p className="eyebrow">LIMITE DISPOSITIVI RAGGIUNTO</p>
          <strong style={{ display: "block", fontFamily: "var(--font-display)", fontSize: 19, marginBottom: 10 }}>
            Puoi usare LUXSCAN su massimo {MAX_DEVICES} dispositivi
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
        <button className="chip-btn" onClick={signOut}>Esci</button>
      </div>
      {children}
    </>
  );
}
