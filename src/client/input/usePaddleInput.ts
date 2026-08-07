import { useEffect, useRef } from "react";
import type { Direction } from "../../shared/protocol";
import { gameBridge } from "../network/gameBridge";

const UP_KEYS = new Set(["w", "arrowup"]);
const DOWN_KEYS = new Set(["s", "arrowdown"]);

export function usePaddleInput(
  active: boolean,
  send: (direction: Direction, sequence: number) => void,
): void {
  const sequence = useRef(0);
  const current = useRef<Direction>(0);

  useEffect(() => {
    const pressed = new Set<string>();
    const publish = () => {
      const up = [...UP_KEYS].some((key) => pressed.has(key));
      const down = [...DOWN_KEYS].some((key) => pressed.has(key));
      const direction: Direction = up === down ? 0 : up ? -1 : 1;
      if (direction === current.current) return;
      current.current = direction;
      sequence.current += 1;
      gameBridge.recordInput(direction, sequence.current);
      send(direction, sequence.current);
    };
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!UP_KEYS.has(key) && !DOWN_KEYS.has(key)) return;
      if (active) event.preventDefault();
      pressed.add(key);
      if (active) publish();
    };
    const keyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!UP_KEYS.has(key) && !DOWN_KEYS.has(key)) return;
      pressed.delete(key);
      if (active) publish();
    };
    const neutralize = () => {
      pressed.clear();
      if (current.current !== 0) {
        current.current = 0;
        sequence.current += 1;
        gameBridge.recordInput(0, sequence.current);
        send(0, sequence.current);
      }
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", neutralize);
    if (!active) neutralize();
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", neutralize);
      neutralize();
    };
  }, [active, send]);
}
