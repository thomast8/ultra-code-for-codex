import type { CSSProperties } from 'react';
import spark from './assets/spark.svg';
import clock from './assets/clock.svg';
import check from './assets/check.svg';
import running from './assets/running.svg';
import alert from './assets/alert.svg';
import chevron from './assets/chevron.svg';
import right from './assets/chevron-right.svg';

const icons = {
  spark: [spark, 18],
  clock: [clock, 14],
  check: [check, 14],
  running: [running, 16],
  alert: [alert, 16],
  chevron: [chevron, 12],
  right: [right, 13],
} as const;

// esbuild leaves quotes unescaped in SVG data URLs, which breaks a quoted CSS url().
export const cssUrl = (source: string) => `url("${source.replaceAll('"', '%22')}")`;

// Icons are alpha masks filled with currentColor, so they follow the host theme.
export function Icon({ name }: { name: keyof typeof icons }) {
  const [source, size] = icons[name];
  const style = { width: size, height: size, '--icon': cssUrl(source) } as CSSProperties;
  return <span className={`icon icon-${name}`} style={style} aria-hidden="true" />;
}

export function Brand() {
  return (
    <span className="ultra-brand">
      <Icon name="spark" />
      <span>Ultra</span>
    </span>
  );
}
