import type { ReactNode, Ref } from 'react';
import styles from './Details.module.css';

/** Native disclosure keeps keyboard behavior and open state across observation refreshes. */
export function Details({
  title,
  hint,
  children,
  ref,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  ref?: Ref<HTMLDetailsElement>;
}) {
  return (
    <details ref={ref} className={styles.details}>
      <summary>
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  );
}
