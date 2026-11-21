import { useEffect, useState } from "react";

type Health = { status: string; service: string };

export function App() {
  const [health, setHealth] = useState<"memuat" | "ok" | "gagal">("memuat");

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then(async (res) => (res.ok ? ((await res.json()) as Health) : null))
      .then((body) => {
        if (alive) setHealth(body?.status === "ok" ? "ok" : "gagal");
      })
      .catch(() => {
        if (alive) setHealth("gagal");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-4xl font-black tracking-tight">Halo, Adu Batang!</h1>
      <p className="text-sm text-neutral-400">
        Kerangka aplikasi sudah jalan di Cloudflare. Kartu, meja, dan mode mainnya menyusul di fase
        berikutnya.
      </p>
      <p className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
        Server: {health === "memuat" ? "memuat…" : health === "ok" ? "sehat ✅" : "tidak merespons ❌"}
      </p>
    </main>
  );
}
