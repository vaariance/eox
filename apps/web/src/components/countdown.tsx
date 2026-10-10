"use client";

import { useEffect, useState } from "react";

export function Countdown() {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setSeconds(60 - (Math.floor(Date.now() / 1000) % 60));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const text = seconds === null ? "0:--" : `0:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span className="num" aria-label="Time until the next cutoff">
      {text}
    </span>
  );
}
