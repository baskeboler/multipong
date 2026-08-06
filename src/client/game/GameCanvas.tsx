import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { COURT } from "../../shared/protocol";
import { PongScene } from "./PongScene";

export function GameCanvas(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: COURT.width,
      height: COURT.height,
      backgroundColor: "#050714",
      scene: PongScene,
      render: { antialias: true, powerPreference: "high-performance" },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: COURT.width,
        height: COURT.height,
      },
    });
    return () => game.destroy(true);
  }, []);

  return <div className="game-canvas" ref={containerRef} aria-label="Multipong court" />;
}
