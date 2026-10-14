import spark from './assets/spark.svg';
import clock from './assets/clock.svg';
import working from './assets/agent-working.svg';
import completed from './assets/agent-completed.svg';
import running from './assets/running.svg';
import alert from './assets/alert.svg';
import chevron from './assets/chevron.svg';
import right from './assets/chevron-right.svg';

const icons = {
  spark: [spark, 20],
  clock: [clock, 15],
  working: [working, 28],
  completed: [completed, 28],
  running: [running, 17],
  alert: [alert, 17],
  chevron: [chevron, 13],
  right: [right, 14],
} as const;

export function Icon({ name }: { name: keyof typeof icons }) {
  const [source, size] = icons[name];
  return <img src={source} width={size} height={size} alt="" aria-hidden="true" />;
}

export function Brand() {
  return (
    <span className="ultra-brand">
      <Icon name="spark" />
      <span>Ultra</span>
    </span>
  );
}
