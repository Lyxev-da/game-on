import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";
import "../clover/game.css";

const CloverApp = lazy(() => import("../clover/App"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Clover RNG | Roll for Rarity" },
      { name: "description", content: "Roll for rare blocky four-leaf clovers, boost your luck and complete the index." },
      { property: "og:title", content: "Clover RNG | Roll for Rarity" },
      { property: "og:description", content: "Roll for rare blocky four-leaf clovers, boost your luck and complete the index." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  // The game uses browser-only APIs, so render it client-side only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <CloverApp />
    </Suspense>
  );
}
