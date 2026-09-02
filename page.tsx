import Scanner from "@/components/Scanner";
import AuthGate from "@/components/AuthGate";

export default function Home() {
  return (
    <AuthGate>
      <Scanner />
    </AuthGate>
  );
}
