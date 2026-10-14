import type { JsonValue } from '../contracts/workflow.js';

type JsonObject = { [key: string]: JsonValue };
type Primitive = string | number | boolean | null;

const acronyms = new Set(['api', 'id', 'pr', 'sha', 'uri', 'url']);
const summaryKeys = ['summary', 'message', 'title', 'headline', 'description'];

export function safeLink(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    return ['https:', 'http:'].includes(url.protocol) ? uri : undefined;
  } catch {
    return undefined;
  }
}

export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return words
    .map((word, index) => {
      if (acronyms.has(word)) return word.toUpperCase();
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'} reported`;
}

export function resultSummary(value: JsonValue): { text: string; key: string | null } | null {
  if (value === null) return null;
  if (Array.isArray(value)) return { text: plural(value.length, 'item'), key: null };
  if (!isObject(value)) return { text: formatPrimitive(value, ''), key: null };
  const entries = Object.entries(value);
  const named = summaryKeys.find((key) => typeof value[key] === 'string' && value[key]);
  if (named) return { text: value[named] as string, key: named };
  const first = entries.find(([, item]) => typeof item === 'string' && item);
  if (first) return { text: first[1] as string, key: first[0] };
  return { text: plural(entries.length, 'field'), key: null };
}

function formatPrimitive(value: Primitive, key: string): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const text = value.toLocaleString();
    return /percent/i.test(key) ? `${text}%` : text;
  }
  return value;
}

function Leaf({ value, name }: { value: Primitive; name: string }) {
  if (typeof value === 'string') {
    const href = safeLink(value);
    if (href)
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {value.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      );
    if (value.includes('\n')) return <p className="result-text">{value}</p>;
  }
  return <>{formatPrimitive(value, name)}</>;
}

function ListValue({ items, name }: { items: JsonValue[]; name: string }) {
  if (!items.length) return <span className="workflow-muted">None</span>;
  return (
    <ul className="result-list">
      {items.map((item, index) => (
        <li key={index}>
          <StructuredValue value={item} name={name} />
        </li>
      ))}
    </ul>
  );
}

export function StructuredValue({
  value,
  name = '',
  omit,
}: {
  value: JsonValue;
  name?: string;
  omit?: string | null;
}) {
  if (Array.isArray(value)) return <ListValue items={value} name={name} />;
  if (!isObject(value)) return <Leaf value={value} name={name} />;
  const entries = Object.entries(value).filter(([key]) => key !== omit);
  if (!entries.length) return <span className="workflow-muted">None</span>;
  return (
    <dl className="workflow-facts result-facts">
      {entries.map(([key, item]) => (
        <div className="workflow-fact" key={key}>
          <dt>{humanizeKey(key)}</dt>
          <dd>
            <StructuredValue value={item} name={key} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
