import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Run } from "./model";
/** The scrolling reply thread: stays at the newest reply unless the user has scrolled up to read. */
export function Thread({
  clientId,
  visible,
  runs,
  children,
}: {
  clientId: string;
  visible: boolean;
  runs: Run[];
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const newest = runs[0];
  const toEnd = () => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  };
  useLayoutEffect(() => {
    stick.current = true;
    toEnd();
  }, [clientId, newest?.id]);
  useLayoutEffect(() => {
    if (stick.current) toEnd();
  }, [visible, newest?.status, newest?.answer?.length]);
  return (
    <div
      className="vd-thread"
      ref={box}
      onScroll={(e) => {
        const b = e.currentTarget;
        stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
      }}
    >
      {children}
    </div>
  );
}
